import { App, PluginSettingTab, Setting } from "obsidian";
import type XMindPlugin from "./main";
import { i18n } from "./i18n";

export interface XMindPluginSettings {
  autoSaveDelay: number;
  embedHeight: number;
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
    const t = i18n.t();
    containerEl.empty();

    new Setting(containerEl)
      .setName(t.settings.title)
      .setHeading();

    new Setting(containerEl)
      .setName(t.settings.autoSaveDelay)
      .setDesc(t.settings.autoSaveDelayDesc)
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
          .setTooltip(t.settings.resetDefaultMs.replace("{ms}", "500"))
          .onClick(async () => {
            this.plugin.settings.autoSaveDelay = DEFAULT_SETTINGS.autoSaveDelay;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(t.settings.embedHeight)
      .setDesc(t.settings.embedHeightDesc)
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
          .setTooltip(t.settings.resetDefaultPx.replace("{px}", "320"))
          .onClick(async () => {
            this.plugin.settings.embedHeight = DEFAULT_SETTINGS.embedHeight;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(t.settings.showOpenWithXMind)
      .setDesc(t.settings.showOpenWithXMindDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showOpenAsXMind)
          .onChange(async (value) => {
            this.plugin.settings.showOpenAsXMind = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.settings.usage)
      .setHeading();
    const info = containerEl.createEl("div", { cls: "xmind-settings-info" });
    info.createEl("p", {
      text: t.settings.usageDesc,
    });
    const ul = info.createEl("ul");
    ul.createEl("li").createEl("code", { text: "![[diagram.xmind]]" }).insertAdjacentText("afterend", ` — ${t.settings.embedInteractivePreview}`);
    ul.createEl("li").createEl("code", { text: "[[diagram.xmind]]" }).insertAdjacentText("afterend", ` — ${t.settings.linkToOpenXMind}`);
    info.createEl("p", {
      text: t.settings.doubleClickTip,
    });
  }
}
