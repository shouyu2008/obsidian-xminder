import { App, PluginSettingTab, Setting } from "obsidian";
import type XMindPlugin from "./main";

export interface XMindPluginSettings {
  /** Auto-save debounce delay in milliseconds */
  autoSaveDelay: number;
  /** Height of embedded mind map previews in pixels */
  embedHeight: number;
  /** Default direction for new mind maps: 1=right, 0=left, 2=both */
  defaultDirection: 0 | 1 | 2;
}

export const DEFAULT_SETTINGS: XMindPluginSettings = {
  autoSaveDelay: 500,
  embedHeight: 320,
  defaultDirection: 2,
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

    containerEl.createEl("h2", { text: "XMinder Settings" });

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
    // Default branch direction
    // -----------------------------------------------------------------------
    new Setting(containerEl)
      .setName("Default branch direction")
      .setDesc("Layout direction for new XMind files created from within Obsidian.")
      .addDropdown((dd) =>
        dd
          .addOption("2", "Both sides")
          .addOption("1", "Right only")
          .addOption("0", "Left only")
          .setValue(String(this.plugin.settings.defaultDirection))
          .onChange(async (value) => {
            this.plugin.settings.defaultDirection = Number(value) as 0 | 1 | 2;
            await this.plugin.saveSettings();
          })
      );

    // -----------------------------------------------------------------------
    // Info section
    // -----------------------------------------------------------------------
    containerEl.createEl("h3", { text: "Usage" });
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
