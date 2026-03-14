import { MarkdownPostProcessorContext, TFile, normalizePath, App } from "obsidian";
import MindElixir from "mind-elixir";
import type { MindElixirInstance } from "mind-elixir";
import { parseXMind } from "../xmind/parser";
import { xmindDataToMindElixir, XMIND_VIEW_TYPE } from "../views/XMindView";
import type XMindPlugin from "../main";
import { i18n } from "../i18n";

// Marker attribute to prevent double-processing
const PROCESSED_ATTR = "data-xmind-processed";

// Flag to prevent processing during view switching
let isViewSwitching = false;

/**
 * Registers embed handling for ![[file.xmind]] and link handling for [[file.xmind]].
 *
 * Since .xmind is an unknown file type, Obsidian doesn't create standard
 * .internal-embed or .file-embed elements. Instead, it renders embeds as
 * links or inline elements. We use multiple strategies to detect and process them:
 *
 * 1. **MarkdownPostProcessor** — Scans rendered markdown for link patterns and
 *    replaces xmind embeds with previews.
 *
 * 2. **MutationObserver** — Watches for new elements appearing in the DOM and
 *    replaces xmind embeds wherever they appear.
 *
 * 3. **Periodic scanning** — Periodically scans all markdown views for unprocessed
 *    xmind embeds, especially important for Reading View which renders upfront.
 */
export function registerEmbedProcessor(plugin: XMindPlugin): void {
  // --- Mechanism 1: MarkdownPostProcessor ---
  // This runs for every markdown block rendered in Reading View
  // Live Preview (CodeMirror) does not trigger MarkdownPostProcessor
  plugin.registerMarkdownPostProcessor(
    (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      // Only process in Reading View to avoid any modifications in Live Preview
      const isReadingView = el.closest(".markdown-reading-view");
      console.log("[XMinder] MarkdownPostProcessor called, isReadingView:", !!isReadingView);
      if (!isReadingView) {
        return;
      }
      
      void processEmbedsInElement(el, ctx.sourcePath, plugin);
      processLinks(el, plugin);
    }
  );

  // --- Mechanism 2: MutationObserver for Reading View ---
  // Sometimes MarkdownPostProcessor doesn't get called (e.g., when switching views)
  // We use MutationObserver to catch .internal-embed elements in Reading View
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (!(node instanceof HTMLElement)) continue;

        // Only process if this is inside a Reading View
        const inReadingView = node.closest(".markdown-reading-view");
        if (!inReadingView) continue;

        // Check for .internal-embed elements
        const embeds: HTMLElement[] = [];
        if (node.classList.contains("internal-embed")) {
          embeds.push(node);
        }
        const childEmbeds = node.querySelectorAll<HTMLElement>(".internal-embed");
        for (const embed of Array.from(childEmbeds)) {
          embeds.push(embed);
        }

        // Process each embed
        for (const embed of embeds) {
          // Skip processing during view switching to prevent race conditions
          if (isViewSwitching) {
            console.log("[XMinder] MutationObserver: skipping - view is switching");
            continue;
          }
          
          const hasProcessed = embed.hasAttribute(PROCESSED_ATTR);
          const src = getEmbedSrc(embed);
          const isXmind = src.toLowerCase().endsWith(".xmind");
          console.log("[XMinder] MutationObserver: detected embed, hasProcessed:", hasProcessed, "isXmind:", isXmind);
          
          if (hasProcessed) continue;
          if (!isXmind) continue;

          // Find source path from active view
          let sourcePath = "";
          const activeLeaf = plugin.app.workspace.activeLeaf;
          if (activeLeaf) {
            const file = (activeLeaf.view as { file?: TFile }).file;
            if (file) sourcePath = file.path;
          }

          console.log("[XMinder] MutationObserver calling replaceEmbedWithPreview");
          void replaceEmbedWithPreview(embed, sourcePath, plugin);
        }
      }
    }
  });

  // Watch for DOM changes in the workspace
  const bodyTarget = typeof document !== 'undefined' ? document.body : null;
  if (bodyTarget) {
    observer.observe(bodyTarget, {
      childList: true,
      subtree: true,
    });
  }

  // --- Mechanism 3: Periodic check for broken embeds ---
  // In case switching back from XMindView doesn't trigger DOM mutations,
  // we periodically scan for embeds with broken mind-elixir instances
  // NOTE: We no longer delete wrappers here - we just log for debugging
  // The cleanupObserver with delayed check handles the actual cleanup
  if (typeof setInterval !== 'undefined') {
    setInterval(() => {
      // Skip during view switching to prevent race conditions
      if (isViewSwitching) {
        console.log("[XMinder] Periodic check: skipping - view is switching");
        return;
      }
      
      const readingViews = document.querySelectorAll(".markdown-reading-view");
      for (const view of Array.from(readingViews)) {
        const embeds = view.querySelectorAll<HTMLElement>(".internal-embed");
        for (const embed of Array.from(embeds)) {
          if (!embed.textContent?.toLowerCase().includes(".xmind")) continue;
          
          // Check if this embed has a wrapper with broken mind-elixir
          let sibling = embed.nextElementSibling;
          while (sibling) {
            if (sibling.classList.contains("xmind-embed-wrapper")) {
              const mapContainer = sibling.querySelector(".map-container");
              const contentContainer = sibling.querySelector(".xmind-embed-container") as HTMLElement | null;
              
              // Check status but don't delete - just log for debugging
              if (!mapContainer && contentContainer) {
                console.log("[XMinder] Periodic check: wrapper exists but no map-container, children:", contentContainer.children.length);
                // Don't delete the wrapper - the mind-elixir might still be initializing
                // or the cleanupObserver delayed check will handle it properly
              }
              break;
            }
            sibling = sibling.nextElementSibling;
          }
        }
      }
    }, 2000); // Check every 2 seconds
  }
}

// ---------------------------------------------------------------------------
// MutationObserver — watches for .file-embed / .internal-embed elements
// appearing anywhere in the workspace and replaces xmind ones with previews.
// ---------------------------------------------------------------------------

/**
 * Check if an element is inside a markdown content area that is SAFE to modify.
 * 
 * Returns an object indicating where the element is and how safe it is to modify.
 */
/**
 * Extract file reference from an embed element.
 * Tries multiple sources since unknown file types may render differently.
 */
function getEmbedSrc(el: HTMLElement): string {
  // Try various attributes where the file reference might be stored
  let src = el.getAttribute("src") ?? 
            el.getAttribute("alt") ?? 
            el.getAttribute("data-src") ?? 
            el.getAttribute("data-path") ?? 
            el.getAttribute("href") ?? 
            "";

  // If still not found, look in child elements (links)
  if (!src) {
    const link = el.querySelector<HTMLAnchorElement>("a[href]");
    if (link) {
      const href = link.getAttribute("href") ?? "";
      if (href.toLowerCase().endsWith(".xmind")) {
        src = href;
      }
    }
  }

  // If still not found, check the title attribute (Obsidian stores embed title there)
  if (!src) {
    const title = el.getAttribute("title") ?? "";
    if (title.toLowerCase().endsWith(".xmind")) {
      src = title;
    }
  }

  // If still not found, check the text content for filename patterns
  if (!src) {
    const text = el.textContent ?? "";
    const match = text.match(/([^\s/\\]+\.xmind)/i);
    if (match) {
      src = match[1];
    }
  }

  return src;
}

/**
 * Try to determine the source markdown file path from the DOM context or workspace.
 * Uses multiple strategies to find the file path.
 */
function findSourcePath(el: HTMLElement, plugin: XMindPlugin): string {
  // Strategy 1: Look for data-path attribute (most reliable)
  let current: HTMLElement | null = el;
  while (current) {
    const path = current.getAttribute("data-path");
    if (path) return path;

    // Check if this is a view-content within a workspace leaf
    if (current.classList.contains("view-content")) {
      // Try to find the leaf via Obsidian's workspace
      const leafEl = current.closest(".workspace-leaf");
      if (leafEl) {
        for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
          if (leaf.view.containerEl.contains(current)) {
            const file = (leaf.view as { file?: TFile }).file;
            if (file) return file.path;
          }
        }
      }
    }

    current = current.parentElement;
  }

  // Strategy 2: Check active leaf (fallback)
  const activeLeaf = plugin.app.workspace.activeLeaf;
  if (activeLeaf) {
    const view = activeLeaf.view as { file?: TFile };
    const file = view?.file;
    if (file) return file.path;
  }

  // Strategy 3: Find any markdown leaf that contains the element
  for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
    if (leaf.view.containerEl.contains(el)) {
      const file = (leaf.view as { file?: TFile }).file;
      if (file) return file.path;
    }
  }

  return "";
}

// ---------------------------------------------------------------------------
// ![[file.xmind]] — embedded preview (shared logic)
// ---------------------------------------------------------------------------

/**
 * Scan an element for xmind embeds and replace them with mind-map previews.
 * Since .xmind is an unknown type, embeds may be rendered as links or generic containers.
 * This function tries multiple detection strategies.
 */
async function processEmbedsInElement(
  el: HTMLElement,
  sourcePath: string,
  plugin: XMindPlugin
): Promise<void> {
  // Strategy 1: Look for .internal-embed elements (Obsidian's default for unknown file types)
  // These are the actual embed containers that Obsidian creates
  const internalEmbeds = el.querySelectorAll<HTMLElement>(".internal-embed");
  
  for (const embed of Array.from(internalEmbeds)) {
    if (embed.hasAttribute(PROCESSED_ATTR)) continue;

    const src = getEmbedSrc(embed);
    if (!src.toLowerCase().endsWith(".xmind")) continue;

    await replaceEmbedWithPreview(embed, sourcePath, plugin);
  }

  // Strategy 2: Look for .file-embed and .embed-container elements
  const fileEmbeds = el.querySelectorAll<HTMLElement>(
    ".file-embed, .embed-container"
  );

  for (const embed of Array.from(fileEmbeds)) {
    if (embed.hasAttribute(PROCESSED_ATTR)) continue;

    const src = getEmbedSrc(embed);
    if (!src.toLowerCase().endsWith(".xmind")) continue;

    await replaceEmbedWithPreview(embed, sourcePath, plugin);
  }

  // Strategy 3: Look for ANY element with a data-src or data-path attribute pointing to .xmind
  // This catches embeds that might be marked differently
  const embeddedElements = el.querySelectorAll<HTMLElement>("[data-src], [data-path]");
  for (const elem of Array.from(embeddedElements)) {
    if (elem.hasAttribute(PROCESSED_ATTR)) continue;
    
    const dataSrc = elem.getAttribute("data-src") ?? "";
    const dataPath = elem.getAttribute("data-path") ?? "";
    
    if (dataSrc.toLowerCase().endsWith(".xmind") || 
        dataPath.toLowerCase().endsWith(".xmind")) {
      await replaceEmbedWithPreview(elem, sourcePath, plugin);
    }
  }

  // Strategy 4: Look for anchor tags that reference .xmind files in embed-like contexts
  const allAnchors = el.querySelectorAll<HTMLAnchorElement>("a[href]");
  for (const link of Array.from(allAnchors)) {
    // Skip if already processed
    if (link.hasAttribute(PROCESSED_ATTR)) continue;
    
    const href = link.getAttribute("href") ?? "";
    
    // Must be a .xmind file reference
    if (!href.toLowerCase().endsWith(".xmind")) continue;
    
    // Only process if this looks like an embed, not a regular inline link
    const parent = link.parentElement;
    if (!parent) continue;
    
    // Case 1: Link is inside an embed container
    if (parent.classList.contains("embed-title") ||
        parent.classList.contains("embed-container") ||
        parent.classList.contains("internal-embed")) {
      await replaceEmbedWithPreview(parent, sourcePath, plugin);
    }
    // Case 2: Link is a direct child of a paragraph/div that ONLY contains this link
    else if (parent.tagName === "P" || parent.tagName === "DIV") {
      const textContent = (parent.textContent ?? "").trim();
      const linkText = (link.textContent ?? "").trim();
      const fileName = href.split('/').pop() ?? "";
      
      // If paragraph mainly contains just this link/filename, treat as embed
      if (linkText === fileName || 
          textContent === linkText || 
          textContent === fileName) {
        await replaceEmbedWithPreview(parent, sourcePath, plugin);
      }
    }
  }
}

/**
 * Replace a single embed element with a rendered mind-map preview.
 */
async function replaceEmbedWithPreview(
  embed: HTMLElement,
  sourcePath: string,
  plugin: XMindPlugin
): Promise<void> {
  console.log("[XMinder] replaceEmbedWithPreview called, hasProcessedAttr:", embed.hasAttribute(PROCESSED_ATTR));
  
  // Check if already processed and wrapper still exists
  if (embed.hasAttribute(PROCESSED_ATTR)) {
    console.log("[XMinder] PROCESSED_ATTR already set, checking wrapper validity...");
    // Look for the wrapper that should be right after this embed
    let sibling = embed.nextElementSibling;
    while (sibling) {
      if (sibling.classList.contains("xmind-embed-wrapper")) {
        const contentContainer = sibling.querySelector(".xmind-embed-container") as HTMLElement | null;
        const mapContainer = contentContainer?.querySelector(".map-container");
        
        console.log("[XMinder]   - mapContainer exists:", !!mapContainer, "isConnected:", mapContainer ? (mapContainer as HTMLElement).isConnected : "N/A");
        
        if (mapContainer && (mapContainer as HTMLElement).isConnected) {
          // Everything is valid, don't reprocess
          console.log("[XMinder] Wrapper and mind-elixir are valid, skipping");
          return;
        } else if (mapContainer && !(mapContainer as HTMLElement).isConnected) {
          // Map container exists but disconnected - likely a view switch in progress
          // Don't rebuild, just wait for DOM to stabilize
          console.log("[XMinder] Mind-elixir temporarily disconnected (view switch), skipping");
          return;
        } else if (contentContainer) {
          // Wrapper exists but no map container (truly broken)
          // Rebuild mind-elixir in the existing container instead of creating new wrapper
          console.log("[XMinder] Mind-elixir is missing, rebuilding in existing container");
          
          const src = getEmbedSrc(embed);
          if (!src.toLowerCase().endsWith(".xmind")) return;
          
          const resolvedFile = plugin.app.metadataCache.getFirstLinkpathDest(src, sourcePath);
          if (!(resolvedFile instanceof TFile)) return;
          
          // Rebuild in existing container
          await buildMindElixirInContainer(contentContainer, resolvedFile, plugin);
          return;  // Important: return here, don't create new wrapper
        } else {
          // No content container, remove wrapper and reprocess
          console.log("[XMinder] No content container, removing wrapper");
          sibling.remove();
          break;
        }
      }
      sibling = sibling.nextElementSibling;
    }
  }
  
  // Mark as being processed
  embed.setAttribute(PROCESSED_ATTR, "true");

  const src = getEmbedSrc(embed);
  console.log("[XMinder] src:", src);
  if (!src.toLowerCase().endsWith(".xmind")) return;

  // Resolve file path relative to current note
  const resolvedFile = plugin.app.metadataCache.getFirstLinkpathDest(
    src,
    sourcePath
  );

  console.log("[XMinder] resolvedFile:", resolvedFile?.path);
  if (!(resolvedFile instanceof TFile)) return;

  // Note: We should only be called from Reading View context (guaranteed by registerEmbedProcessor)
  // But as a safety check, verify we're not in an editable context
  const isEditableContext = embed.closest(".cm-editor") || embed.closest(".CodeMirror");
  console.log("[XMinder] isEditableContext:", isEditableContext);
  if (isEditableContext) {
    return;
  }

  // Strategy: Hide the original embed and create a new wrapper div next to it
  // This is safe because we're in Reading View which is read-only
  
  embed.setCssStyles({ display: "none" });

  // Safety check: Remove any existing wrappers to prevent duplicates
  // This handles race conditions where multiple calls might occur
  let existingSibling = embed.nextElementSibling;
  while (existingSibling) {
    const next = existingSibling.nextElementSibling;
    if (existingSibling.classList.contains("xmind-embed-wrapper")) {
      console.log("[XMinder] Removing existing wrapper before creating new one");
      existingSibling.remove();
    }
    existingSibling = next;
  }

  // Create a wrapper div to insert after the embed
  const wrapper = typeof document !== 'undefined' ? document.createElement("div") : null;
  if (!wrapper) {
    return;
  }

  wrapper.className = "xmind-embed-wrapper xmind-embed-block";
  wrapper.setAttribute(PROCESSED_ATTR, "true");
  
  // Insert wrapper right after the hidden embed
  embed.parentElement?.insertBefore(wrapper, embed.nextSibling);

  const contentContainer = typeof document !== 'undefined' ? document.createElement("div") : null;
  if (!contentContainer) {
    return;
  }
  contentContainer.className = "xmind-embed-container";

  // Set proper dimensions for the container
  const height = plugin.settings.embedHeight ?? 400;
  contentContainer.setCssStyles({
    width: "100%",
    height: `${height}px`,
    position: "relative",
  });
  
  wrapper.appendChild(contentContainer);

  const loading = typeof document !== 'undefined' ? document.createElement("div") : null;
  if (!loading) return;
  loading.className = "xmind-embed-loading";
  loading.textContent = i18n.t().embed.loadingXMind;
  contentContainer.appendChild(loading);

  try {
    const buffer = await plugin.app.vault.adapter.readBinary(
      normalizePath(resolvedFile.path)
    );
    
    const multiSheet = await parseXMind(buffer);
    
    const meData = xmindDataToMindElixir(multiSheet.sheets[0]);

    // If container was removed from DOM while we were loading, bail out
    if (!contentContainer.isConnected) {
      return;
    }

    loading.remove();

    const isDark = typeof document !== 'undefined' && document.body.classList.contains("theme-dark");

    const mind: MindElixirInstance = new MindElixir({
      el: contentContainer,
      direction: MindElixir.SIDE,
      draggable: false,
      editable: false,
      contextMenu: false,
      toolBar: false,
      keypress: false,
      theme: isDark ? MindElixir.DARK_THEME : MindElixir.THEME,
      selectionContainer: typeof document !== 'undefined' ? document.body : undefined,
    });

    mind.init(meData);

    // Fit to container after render — use longer delay to ensure the
    // embed container has been properly laid out with correct dimensions
    const setTimeoutFn = typeof setTimeout !== 'undefined' ? setTimeout : (fn: () => void, ms: number) => { fn(); return 1; };
    const clearTimeoutFn = typeof clearTimeout !== 'undefined' ? clearTimeout : (_id: number) => {};
    
    let fitTimer: number | null = null;
    let hasCalledFit = false;
    
    const performFit = () => {
      if (contentContainer.isConnected && !hasCalledFit) {
        hasCalledFit = true;
        mind.scaleFit();
        mind.toCenter();
      }
    };
    
    // Use ResizeObserver to detect when container is actually rendered with dimensions
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            performFit();
            if (resizeObserver) resizeObserver.disconnect();
          }
        }
      });
      resizeObserver.observe(contentContainer);
    }
    
    // Fallback: also use timeout in case ResizeObserver doesn't work
    fitTimer = setTimeoutFn(() => {
      performFit();
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    }, 500);

    // Clean up mind-elixir instance when the container is removed from DOM
    // This is critical to prevent memory leaks and broken references
    // Use delayed check to avoid false positives during view switching
    let isDestroyed = false;
    let cleanupCheckTimer: number | null = null;
    let wasDisconnected = false;
    const cleanupObserver = new MutationObserver(() => {
      if (!contentContainer.isConnected && !isDestroyed) {
        // Mark as disconnected for later check
        wasDisconnected = true;
        // Don't immediately destroy - the container might be temporarily disconnected
        // during view switching. Wait and check again.
        if (cleanupCheckTimer === null) {
          cleanupCheckTimer = window.setTimeout(() => {
            cleanupCheckTimer = null;
            // Check again after delay - if still disconnected, then truly cleanup
            if (!contentContainer.isConnected && !isDestroyed) {
              console.log("[XMinder] cleanupObserver: container confirmed disconnected, destroying mind-elixir");
              isDestroyed = true;
              if (fitTimer !== null) {
                clearTimeoutFn(fitTimer);
              }
              if (resizeObserver) {
                resizeObserver.disconnect();
              }
              mind.destroy?.();
              cleanupObserver.disconnect();
            } else if (wasDisconnected && contentContainer.isConnected) {
              // Container was disconnected but is now reconnected (view switch completed)
              // Need to refresh the mind-elixir rendering
              console.log("[XMinder] cleanupObserver: container reconnected, refreshing mind-elixir");
              wasDisconnected = false;
              try {
                // Re-fit and re-center to refresh the display
                mind.scaleFit();
                mind.toCenter();
              } catch (e) {
                console.log("[XMinder] cleanupObserver: refresh failed, will rebuild");
                // If refresh fails, trigger a rebuild by clearing and re-rendering
                isDestroyed = true;
                cleanupObserver.disconnect();
                void buildMindElixirInContainer(contentContainer, resolvedFile, plugin);
              }
            }
          }, 2000);  // Wait 2 seconds before cleanup
        }
      }
    });
    const target = typeof document !== 'undefined' ? document.body : null;
    if (target) {
      cleanupObserver.observe(target, {
        childList: true,
        subtree: true,
      });
    }

    // Click on the preview → open in full XMind view
    contentContainer.addEventListener("click", (e) => {
      e.preventDefault();
      void openXMindView(plugin.app, resolvedFile);
    });
    contentContainer.addClass("xmind-embed-clickable");
    contentContainer.title = i18n.t().embed.clickToOpen.replace("{name}", resolvedFile.basename);
  } catch (err) {
    loading.remove();
    const errorEl = typeof document !== 'undefined' ? document.createElement("div") : null;
    if (!errorEl) return;
    errorEl.className = "xmind-embed-error";
    const errorMsg = err instanceof Error ? err.message : String(err);
    errorEl.textContent = i18n.t().embed.loadFailed.replace("{name}", resolvedFile.name).replace("{error}", errorMsg);
    contentContainer.appendChild(errorEl);
  }
}

// ---------------------------------------------------------------------------
// Helper: build mind-elixir in an existing container (for rebuilding)
// ---------------------------------------------------------------------------

async function buildMindElixirInContainer(
  contentContainer: HTMLElement,
  resolvedFile: TFile,
  plugin: XMindPlugin
): Promise<void> {
  // Clear existing content
  contentContainer.replaceChildren();
  
  // Set proper dimensions
  const height = plugin.settings.embedHeight ?? 400;
  contentContainer.setCssStyles({
    width: "100%",
    height: `${height}px`,
    position: "relative",
  });
  
  const loading = document.createElement("div");
  loading.className = "xmind-embed-loading";
  loading.textContent = i18n.t().embed.loadingXMind;
  contentContainer.appendChild(loading);
  
  try {
    const buffer = await plugin.app.vault.adapter.readBinary(
      normalizePath(resolvedFile.path)
    );
    
    const multiSheet = await parseXMind(buffer);
    const meData = xmindDataToMindElixir(multiSheet.sheets[0]);
    
    // If container was removed from DOM while we were loading, bail out
    if (!contentContainer.isConnected) {
      return;
    }
    
    loading.remove();
    
    const isDark = document.body.classList.contains("theme-dark");
    
    const mind: MindElixirInstance = new MindElixir({
      el: contentContainer,
      direction: MindElixir.SIDE,
      draggable: false,
      editable: false,
      contextMenu: false,
      toolBar: false,
      keypress: false,
      theme: isDark ? MindElixir.DARK_THEME : MindElixir.THEME,
      selectionContainer: document.body,
    });
    
    mind.init(meData);
    
    // Fit to container after render
    let fitTimer: number | null = null;
    let hasCalledFit = false;
    
    const performFit = () => {
      if (contentContainer.isConnected && !hasCalledFit) {
        hasCalledFit = true;
        mind.scaleFit();
        mind.toCenter();
      }
    };
    
    // Use ResizeObserver to detect when container is actually rendered
    let resizeObserver: ResizeObserver | null = null;
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          performFit();
          if (resizeObserver) resizeObserver.disconnect();
        }
      }
    });
    resizeObserver.observe(contentContainer);
    
    // Fallback timeout
    fitTimer = window.setTimeout(() => {
      performFit();
      if (resizeObserver) resizeObserver.disconnect();
    }, 500);
    
    // Clean up mind-elixir instance when container is removed
    // Use delayed check to avoid false positives during view switching
    let isDestroyed = false;
    let cleanupCheckTimer: number | null = null;
    let wasDisconnected = false;
    const cleanupObserver = new MutationObserver(() => {
      if (!contentContainer.isConnected && !isDestroyed) {
        wasDisconnected = true;
        // Don't immediately destroy - wait and check again
        if (cleanupCheckTimer === null) {
          cleanupCheckTimer = window.setTimeout(() => {
            cleanupCheckTimer = null;
            if (!contentContainer.isConnected && !isDestroyed) {
              console.log("[XMinder] buildMindElixirInContainer cleanupObserver: container confirmed disconnected, destroying");
              isDestroyed = true;
              if (fitTimer !== null) window.clearTimeout(fitTimer);
              if (resizeObserver) resizeObserver.disconnect();
              mind.destroy?.();
              cleanupObserver.disconnect();
            } else if (wasDisconnected && contentContainer.isConnected) {
              // Container reconnected after being disconnected - refresh display
              console.log("[XMinder] buildMindElixirInContainer cleanupObserver: container reconnected, refreshing");
              wasDisconnected = false;
              try {
                mind.scaleFit();
                mind.toCenter();
              } catch (e) {
                console.log("[XMinder] buildMindElixirInContainer cleanupObserver: refresh failed, rebuilding");
                isDestroyed = true;
                cleanupObserver.disconnect();
                void buildMindElixirInContainer(contentContainer, resolvedFile, plugin);
              }
            }
          }, 2000);  // Wait 2 seconds before cleanup
        }
      }
    });
    cleanupObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
    
    // Click to open in full view
    contentContainer.addEventListener("click", (e) => {
      e.preventDefault();
      void openXMindView(plugin.app, resolvedFile);
    });
    contentContainer.addClass("xmind-embed-clickable");
    contentContainer.title = i18n.t().embed.clickToOpen.replace("{name}", resolvedFile.basename);
  } catch (err) {
    loading.remove();
    const errorEl = document.createElement("div");
    errorEl.className = "xmind-embed-error";
    const errorMsg = err instanceof Error ? err.message : String(err);
    errorEl.textContent = i18n.t().embed.loadFailed.replace("{name}", resolvedFile.name).replace("{error}", errorMsg);
    contentContainer.appendChild(errorEl);
  }
}

// ---------------------------------------------------------------------------
// [[file.xmind]] — internal link
// ---------------------------------------------------------------------------

function processLinks(el: HTMLElement, plugin: XMindPlugin): void {
  const links = el.querySelectorAll<HTMLAnchorElement>("a.internal-link");

  for (const link of Array.from(links)) {
    const href = link.getAttribute("href") ?? "";
    const filePart = href.split("#")[0];
    if (!filePart.toLowerCase().endsWith(".xmind")) continue;

    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const resolvedFile = plugin.app.metadataCache.getFirstLinkpathDest(
        filePart,
        ""
      );

      if (resolvedFile instanceof TFile) {
        void openXMindView(plugin.app, resolvedFile);
      } else {
        void plugin.app.workspace.openLinkText(filePart, "");
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Helper: open file in XMind view
// ---------------------------------------------------------------------------

async function openXMindView(app: App, file: TFile): Promise<void> {
  // Set flag to prevent MutationObserver from interfering during view switch
  isViewSwitching = true;
  console.log("[XMinder] openXMindView: setting isViewSwitching = true");
  
  try {
    const existing = app.workspace
      .getLeavesOfType(XMIND_VIEW_TYPE)
      .find(
        (leaf) => (leaf.view as { file?: TFile }).file?.path === file.path
      );

    if (existing) {
      void app.workspace.revealLeaf(existing);
      return;
    }

    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    void app.workspace.revealLeaf(leaf);
  } finally {
    // Delay clearing the flag to allow DOM to stabilize after view switch
    setTimeout(() => {
      isViewSwitching = false;
      console.log("[XMinder] openXMindView: setting isViewSwitching = false");
    }, 1000);
  }
}
