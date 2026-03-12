import { App, PluginSettingTab, Setting } from "obsidian";
import type XMindPlugin from "./main";

export interface XMindPluginSettings {
  /** Auto-save debounce delay in milliseconds */
  autoSaveDelay: number;
  /** Height of embedded mind map previews in pixels */
  embedHeight: number;
  /** Show "Open as XMind" in file context menu (for users with XMind app installed) */
  showOpenAsXMind: boolean;
}

export const DEFAULT_SETTINGS: XMindPluginSettings = {
  autoSaveDelay: 500,
  embedHeight: 320,
  showOpenAsXMind: true,
};

export class XMindSettingTab extends PluginSettingTab {
  plugin: XMindPlugin;

  constructor(app: App, plugin: XMindPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("XMinder preferences")
      .setHeading();

    // -----------------------------------------------------------------------
    // Auto-save delay
    // -----------------------------------------------------------------------
    new Setting(containerEl)
      .setName("Auto-save delay")
      .setDesc(
        "Time (in milliseconds) to wait after the last edit before automatically saving the .xmind file. Set to 0 to disable auto-save."
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 5000, 100)
          .setValue(this.plugin.settings.autoSaveDelay)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.autoSaveDelay = value;
            await this.plugin.saveSettings();
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("Reset to default (500ms)")
          .onClick(async () => {
            this.plugin.settings.autoSaveDelay = DEFAULT_SETTINGS.autoSaveDelay;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // -----------------------------------------------------------------------
    // Embed preview height
    // -----------------------------------------------------------------------
    new Setting(containerEl)
      .setName("Embed preview height")
      .setDesc(
        "Height (in pixels) of the inline mind map preview when using ![[file.xmind]] in a note."
      )
      .addSlider((slider) =>
        slider
          .setLimits(150, 800, 10)
          .setValue(this.plugin.settings.embedHeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.embedHeight = value;
            await this.plugin.saveSettings();
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("Reset to default (320px)")
          .onClick(async () => {
            this.plugin.settings.embedHeight = DEFAULT_SETTINGS.embedHeight;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // -----------------------------------------------------------------------
    // Open as XMind toggle
    // -----------------------------------------------------------------------
    new Setting(containerEl)
      .setName("Show \"Open as XMind\" menu")
      .setDesc(
        "Show an \"Open as XMind\" option in the file context menu, which opens .xmind files with the external XMind application. Enable this if you have the XMind app installed."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showOpenAsXMind)
          .onChange(async (value) => {
            this.plugin.settings.showOpenAsXMind = value;
            await this.plugin.saveSettings();
          })
      );

    // -----------------------------------------------------------------------
    // Info section
    // -----------------------------------------------------------------------
    new Setting(containerEl)
      .setName("Usage")
      .setHeading();
    const info = containerEl.createEl("div", { cls: "xmind-settings-info" });
    info.createEl("p", {
      text: "Supported syntax in Markdown notes:",
    });
    const ul = info.createEl("ul");
    ul.createEl("li").createEl("code", { text: "![[diagram.xmind]]" }).insertAdjacentText("afterend", " — embed an interactive preview");
    ul.createEl("li").createEl("code", { text: "[[diagram.xmind]]" }).insertAdjacentText("afterend", " — link that opens the XMind view");
    info.createEl("p", {
      text: "Double-click any .xmind file in the file explorer to open the interactive mind map editor.",
    });
  }
}
