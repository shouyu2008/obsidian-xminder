import { PluginSettingTab } from "obsidian";
import type { App, Setting, SettingDefinitionItem, SliderComponent } from "obsidian";
import type XMindPlugin from "./main";
import { i18n } from "./i18n";

export interface XMindPluginSettings {
  autoSaveDelay: number;
  embedHeight: number;
  showOpenAsXMind: boolean;
  clipboardExportEnabled: boolean;
}

export const DEFAULT_SETTINGS: XMindPluginSettings = {
  autoSaveDelay: 500,
  embedHeight: 320,
  showOpenAsXMind: true,
  clipboardExportEnabled: true,
};

export class XMindSettingTab extends PluginSettingTab {
  plugin: XMindPlugin;

  constructor(app: App, plugin: XMindPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Declarative settings definitions, rendered by Obsidian 1.13.0+ and used
   * to build the settings search index. The two sliders use a `render`
   * definition so they can keep their "restore default" buttons; the toggles
   * use the built-in `control` bindings, which persist through
   * `getControlValue`/`setControlValue`.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const t = i18n.t();
    return [
      {
        type: "group",
        heading: t.settings.title,
        items: [
          {
            name: t.settings.autoSaveDelay,
            desc: t.settings.autoSaveDelayDesc,
            render: (setting) => {
              this.renderAutoSaveDelay(setting);
            },
          },
          {
            name: t.settings.embedHeight,
            desc: t.settings.embedHeightDesc,
            render: (setting) => {
              this.renderEmbedHeight(setting);
            },
          },
          {
            name: t.settings.showOpenWithXMind,
            desc: t.settings.showOpenWithXMindDesc,
            control: {
              type: "toggle",
              key: "showOpenAsXMind",
              defaultValue: DEFAULT_SETTINGS.showOpenAsXMind,
            },
          },
          {
            name: t.settings.clipboardExport,
            desc: t.settings.clipboardExportDesc,
            control: {
              type: "toggle",
              key: "clipboardExportEnabled",
              defaultValue: DEFAULT_SETTINGS.clipboardExportEnabled,
            },
          },
        ],
      },
      {
        type: "group",
        heading: t.settings.usage,
        items: [
          {
            name: t.settings.usageDesc,
            render: (setting) => {
              this.buildUsageInfo(setting.controlEl);
            },
          },
        ],
      },
    ];
  }

  private renderAutoSaveDelay(setting: Setting): void {
    const t = i18n.t();
    let slider: SliderComponent | null = null;

    setting
      .setName(t.settings.autoSaveDelay)
      .setDesc(t.settings.autoSaveDelayDesc)
      .addSlider((component) => {
        slider = component;
        component
          .setLimits(0, 5000, 100)
          .setValue(this.plugin.settings.autoSaveDelay)
          .setDisplayFormat((value) => `${value} ms`)
          .onChange(async (value) => {
            this.plugin.settings.autoSaveDelay = value;
            await this.plugin.saveSettings();
          });
      })
      .addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip(t.settings.resetDefaultMs.replace("{ms}", "500"))
          .onClick(async () => {
            this.plugin.settings.autoSaveDelay = DEFAULT_SETTINGS.autoSaveDelay;
            await this.plugin.saveSettings();
            slider?.setValue(DEFAULT_SETTINGS.autoSaveDelay);
          })
      );
  }

  private renderEmbedHeight(setting: Setting): void {
    const t = i18n.t();
    let slider: SliderComponent | null = null;

    setting
      .setName(t.settings.embedHeight)
      .setDesc(t.settings.embedHeightDesc)
      .addSlider((component) => {
        slider = component;
        component
          .setLimits(150, 800, 10)
          .setValue(this.plugin.settings.embedHeight)
          .setDisplayFormat((value) => `${value} px`)
          .onChange(async (value) => {
            this.plugin.settings.embedHeight = value;
            await this.plugin.saveSettings();
          });
      })
      .addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip(t.settings.resetDefaultPx.replace("{px}", "320"))
          .onClick(async () => {
            this.plugin.settings.embedHeight = DEFAULT_SETTINGS.embedHeight;
            await this.plugin.saveSettings();
            slider?.setValue(DEFAULT_SETTINGS.embedHeight);
          })
      );
  }

  private buildUsageInfo(container: HTMLElement): void {
    const t = i18n.t();
    const info = container.createDiv({ cls: "xmind-settings-info" });
    const ul = info.createEl("ul");
    ul.createEl("li").createEl("code", { text: "![[diagram.xmind]]" }).insertAdjacentText("afterend", ` — ${t.settings.embedInteractivePreview}`);
    ul.createEl("li").createEl("code", { text: "[[diagram.xmind]]" }).insertAdjacentText("afterend", ` — ${t.settings.linkToOpenXMind}`);
    info.createEl("p", {
      text: t.settings.doubleClickTip,
    });
  }
}
