# Reading View Embed 问题诊断工具和验证清单

## 快速诊断流程

### 步骤1：验证选择器是否生效

在浏览器控制台中运行（针对已打开的Reading View）：

```javascript
// 查找.internal-embed元素
const embeds1 = document.querySelectorAll(".internal-embed");
console.log("Found .internal-embed:", embeds1.length);
embeds1.forEach(el => console.log(el));

// 查找.file-embed元素
const embeds2 = document.querySelectorAll(".file-embed");
console.log("Found .file-embed:", embeds2.length);
embeds2.forEach(el => console.log(el));

// 查找任何包含.xmind的元素
const allElements = document.querySelectorAll("*");
let xmindElements = [];
for (const el of allElements) {
  if (el.textContent?.includes(".xmind") || 
      el.getAttribute("alt")?.includes(".xmind") ||
      el.getAttribute("href")?.includes(".xmind") ||
      el.getAttribute("src")?.includes(".xmind")) {
    xmindElements.push({
      tag: el.tagName,
      class: el.className,
      text: el.textContent?.slice(0, 50),
      alt: el.getAttribute("alt"),
      href: el.getAttribute("href"),
      src: el.getAttribute("src"),
      element: el
    });
  }
}
console.log("Found .xmind elements:", xmindElements);
```

**预期结果：**
- ❌ `.internal-embed` 和 `.file-embed` 应该为 0
- ✓ 应该在 `xmindElements` 中看到链接或纯文本

### 步骤2：检查Reading View容器

```javascript
// 查找Reading View的容器
const leaves = this.app.workspace.getLeavesOfType("markdown");
console.log("Markdown leaves:", leaves.length);

for (const leaf of leaves) {
  console.log("\n=== Leaf ===");
  console.log("containerEl:", leaf.view.containerEl);
  console.log("containerEl.className:", leaf.view.containerEl.className);
  
  // 尝试查找.markdown-reading-view
  const rv = leaf.view.containerEl?.querySelector?.(".markdown-reading-view");
  console.log(".markdown-reading-view found:", !!rv);
  
  // 尝试查找.view-content
  const vc = leaf.view.containerEl?.querySelector?.(".view-content");
  console.log(".view-content found:", !!vc);
  
  // 查看实际的first child
  console.log("First child:", leaf.view.containerEl.firstChild);
  
  // 查看所有直接子元素
  console.log("Direct children:");
  for (const child of leaf.view.containerEl.children) {
    console.log("  -", child.tagName, child.className);
  }
}
```

**预期结果：**
- ❌ `.markdown-reading-view` 选择器可能不工作
- 应该看到实际的DOM结构（可能是 `.view-content`, `.markdown-source-view` 等）

### 步骤3：检查源文件路径

```javascript
// 获取当前活跃的markdown文件
const activeLeaf = this.app.workspace.activeLeaf;
if (activeLeaf?.view?.file) {
  console.log("Active file path:", activeLeaf.view.file.path);
  console.log("Active file name:", activeLeaf.view.file.name);
  
  // 尝试查找包含.xmind的元素
  const container = activeLeaf.view.containerEl;
  const xmindRefs = container.querySelectorAll("*");
  
  for (const el of xmindRefs) {
    if (el.textContent?.includes(".xmind")) {
      console.log("\n.xmind reference found:");
      console.log("  File path:", activeLeaf.view.file.path);
      console.log("  Element:", el);
      console.log("  Text content:", el.textContent);
      
      // 尝试解析文件
      const text = el.textContent;
      const match = text.match(/([^\s]+\.xmind)/i);
      if (match) {
        const fileName = match[1];
        console.log("  Extracted filename:", fileName);
        
        // 尝试解析
        const resolved = this.app.metadataCache.getFirstLinkpathDest(
          fileName,
          activeLeaf.view.file.path
        );
        console.log("  Resolved file:", resolved);
      }
    }
  }
} else {
  console.log("No active markdown file");
}
```

### 步骤4：检查MutationObserver是否工作

```javascript
// 添加临时的MutationObserver日志
let mutationCount = 0;
const debugObserver = new MutationObserver((mutations) => {
  mutationCount++;
  console.log("Mutation #" + mutationCount);
  
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) { // Element node
          console.log("  Added:", node.tagName, node.className);
          
          // 检查是否包含.xmind
          if (node.textContent?.includes?.(".xmind")) {
            console.log("    Contains .xmind!");
          }
          
          // 检查是否有.internal-embed或.file-embed
          if (node.classList?.contains("internal-embed") || 
              node.classList?.contains("file-embed")) {
            console.log("    Has embed class!");
          }
        }
      }
    }
  }
});

debugObserver.observe(document.body, { childList: true, subtree: true });

// 现在切换tab或打开新文件，观察输出
console.log("Observing mutations... (switch tabs to trigger)");

// 30秒后停止
setTimeout(() => {
  debugObserver.disconnect();
  console.log("Stopped observing. Total mutations:", mutationCount);
}, 30000);
```

---

## 完整的验证清单

### 验证项1：Embed元素结构

- [ ] 在Live Preview中查看embed — 应该看到 `.internal-embed` 或 `.file-embed` 类
- [ ] 在Reading View中查看embed — 应该看到普通 `<a>` 或 `<p>` 元素
- [ ] 记录两种视图中的实际HTML结构

**填写：**
```
Live Preview中的HTML：
_____________________________________________________

Reading View中的HTML：
_____________________________________________________
```

### 验证项2：postProcessor调用

```typescript
// 在EmbedProcessor.ts的postProcessor回调中添加日志
plugin.registerMarkdownPostProcessor(
  async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    console.log("[DEBUG] postProcessor called!");
    console.log("  el:", el);
    console.log("  sourcePath:", ctx.sourcePath);
    void processEmbedsInElement(el, ctx.sourcePath, plugin);
    processLinks(el, plugin);
  }
);
```

- [ ] 在Live Preview中是否看到 "[DEBUG] postProcessor called!"
- [ ] 在Reading View中是否看到 "[DEBUG] postProcessor called!"
- [ ] 记录调用次数

**填写：**
```
Live Preview中postProcessor被调用 ____ 次
Reading View中postProcessor被调用 ____ 次
sourcePath值：_____________________
```

### 验证项3：querySelector效果

```typescript
// 在startReadingViewObserver中添加日志
const scanLeafForEmbeds = (leaf: any) => {
  if (!leaf || !leaf.view) return;
  
  console.log("[DEBUG] Scanning leaf...");
  const viewContent = leaf.view.containerEl?.querySelector?.(".markdown-reading-view");
  console.log("  .markdown-reading-view found:", !!viewContent);
  
  // 尝试其他选择器
  const vc = leaf.view.containerEl?.querySelector?.(".view-content");
  console.log("  .view-content found:", !!vc);
  
  // 查看实际结构
  console.log("  containerEl classes:", leaf.view.containerEl?.className);
  
  if (viewContent instanceof HTMLElement) {
    const file = (leaf.view as { file?: TFile }).file;
    if (file) {
      void processEmbedsInElement(viewContent, file.path, plugin);
    }
  }
};
```

- [ ] 记录实际返回的选择器结果
- [ ] 检查containerEl的实际className

**填写：**
```
.markdown-reading-view 找到了吗？ ______
.view-content 找到了吗？ ______
实际的className： ___________________________
```

### 验证项4：embed元素检测

```typescript
// 在isXMindEmbed中添加日志
function isXMindEmbed(el: HTMLElement): boolean {
  if (el.hasAttribute(PROCESSED_ATTR)) return false;
  
  console.log("[DEBUG] Checking element:", el.tagName, el.className);
  
  if (
    !el.classList.contains("internal-embed") &&
    !el.classList.contains("file-embed")
  ) {
    console.log("  No embed classes found");
    return false;
  }

  const src = getEmbedSrc(el);
  console.log("  src:", src);
  return src.toLowerCase().endsWith(".xmind");
}
```

- [ ] 记录检测到的元素
- [ ] 记录为什么元素被拒绝

**填写：**
```
检测到的元素：
_____________________________________________________

被拒绝的原因：
_____________________________________________________
```

### 验证项5：sourcePath解析

```typescript
// 在findSourcePath中添加日志
function findSourcePath(el: HTMLElement, plugin: XMindPlugin): string {
  console.log("[DEBUG] Finding source path...");
  
  let current: HTMLElement | null = el;
  let depth = 0;
  while (current) {
    console.log(`  [Level ${depth}] Tag: ${current.tagName}, Classes: ${current.className}`);
    
    const path = current.getAttribute("data-path");
    if (path) {
      console.log("    Found data-path:", path);
      return path;
    }

    if (current.classList.contains("view-content")) {
      console.log("    Found view-content");
      // ... rest of logic
    }

    current = current.parentElement;
    depth++;
    
    if (depth > 20) {
      console.log("    Reached document root, stopping search");
      break;
    }
  }
  
  console.log("  Source path not found, returning empty string");
  return "";
}
```

- [ ] 记录DOM树遍历过程
- [ ] 记录sourcePath是否被找到

**填写：**
```
DOM树遍历过程：
_____________________________________________________

最终的sourcePath：
_____________________________________________________
```

---

## 自动化诊断脚本

将以下代码保存为 `diagnostic.js` 并在Obsidian控制台中运行：

```javascript
(function() {
  const report = {
    timestamp: new Date().toISOString(),
    findings: {}
  };

  // Test 1: Check selector existence
  const embeds1 = document.querySelectorAll(".internal-embed");
  const embeds2 = document.querySelectorAll(".file-embed");
  report.findings.selectorTest = {
    internalEmbedCount: embeds1.length,
    fileEmbedCount: embeds2.length,
    result: embeds1.length === 0 && embeds2.length === 0 ? 
      "PROBLEM: No embeds found with current selectors" : 
      "OK: Selectors working"
  };

  // Test 2: Check container querySelector
  const leaves = app.workspace.getLeavesOfType("markdown");
  report.findings.containerTest = {
    markdownLeavesCount: leaves.length,
    containers: []
  };
  
  for (const leaf of leaves) {
    const rv = leaf.view.containerEl?.querySelector?.(".markdown-reading-view");
    const vc = leaf.view.containerEl?.querySelector?.(".view-content");
    
    report.findings.containerTest.containers.push({
      markdownReadingViewFound: !!rv,
      viewContentFound: !!vc,
      actualClasses: leaf.view.containerEl?.className
    });
  }

  // Test 3: Check .xmind references
  const allElements = document.querySelectorAll("*");
  let xmindCount = 0;
  const xmindTypes = {};
  
  for (const el of allElements) {
    if (el.textContent?.includes(".xmind")) {
      xmindCount++;
      const type = el.tagName + "." + el.className;
      xmindTypes[type] = (xmindTypes[type] || 0) + 1;
    }
  }
  
  report.findings.xmindReferences = {
    totalCount: xmindCount,
    elementTypes: xmindTypes
  };

  console.log("=== Reading View Embed Diagnostic Report ===");
  console.log(JSON.stringify(report, null, 2));
  return report;
})();
```

---

## 问题判断决策树

```
Q1: 在Reading View中看到.xmind embed吗？
├─ 是 → 不需要修复
└─ 否 → 继续

Q2: 运行选择器测试，找到了.internal-embed或.file-embed吗？
├─ 是 → 选择器问题 → 修复选择器逻辑
└─ 否 → 继续

Q3: 找到了包含.xmind的<a>或<p>元素吗？
├─ 是 → Reading View渲染为链接/纯文本
│   └─ 需要改变检测方式（支持href、textContent等）
└─ 否 → 继续

Q4: querySelector(".markdown-reading-view")成功了吗？
├─ 是 → 继续
├─ 否 → 容器选择器错误
│   └─ 需要更新容器查询逻辑
└─ 不确定 → 使用诊断工具检查实际结构

Q5: postProcessor在Reading View中被调用了吗？
├─ 是 → postProcessor逻辑问题
├─ 否 → Obsidian不为未知类型调用postProcessor
│   └─ 需要依赖MutationObserver或直接扫描
└─ 不确定 → 添加日志进行验证

Q6: MutationObserver在Reading View中被触发了吗？
├─ 是 → 回调中的检测逻辑失效
│   └─ 改进isXMindEmbed函数
└─ 否 → Reading View渲染不产生可检测的mutations
    └─ 需要定时扫描而不是等待mutations
```

---

## 根据诊断结果的修复建议

### 场景A：选择器不起作用

**症状：**
- `.internal-embed` 和 `.file-embed` 都找不到
- 但找到了包含.xmind的`<a>`或`<p>`元素

**修复：**
```typescript
// 新的detectXMindEmbed函数
function findXMindEmbeds(el: HTMLElement): HTMLElement[] {
  const results: HTMLElement[] = [];
  
  // 方式1：检查现有的embed容器
  const embeds = el.querySelectorAll(".internal-embed, .file-embed");
  for (const embed of embeds) {
    if (getEmbedSrc(embed)?.toLowerCase().endsWith(".xmind")) {
      results.push(embed);
    }
  }
  
  // 方式2：检查包含.xmind的链接
  const links = el.querySelectorAll("a.internal-link");
  for (const link of links) {
    const href = link.getAttribute("href") || link.getAttribute("data-href") || "";
    if (href.toLowerCase().endsWith(".xmind")) {
      results.push(link);
    }
  }
  
  // 方式3：检查包含.xmind的纯文本（最后的手段）
  // ...（更复杂）
  
  return results;
}
```

### 场景B：容器查询不起作用

**症状：**
- querySelector(".markdown-reading-view") 返回null

**修复：**
```typescript
function getReadingViewContent(leaf: any): HTMLElement | null {
  // 尝试多个可能的选择器
  const selectors = [
    ".markdown-reading-view",
    ".view-content",
    ".markdown-source-view",
    ".markdown-preview-view"
  ];
  
  for (const selector of selectors) {
    const result = leaf.view.containerEl?.querySelector?.(selector);
    if (result instanceof HTMLElement) {
      console.log("Found content using:", selector);
      return result;
    }
  }
  
  // 如果都不行，返回containerEl本身
  console.log("No specific selector worked, using containerEl");
  return leaf.view.containerEl instanceof HTMLElement ? 
    leaf.view.containerEl : null;
}
```

### 场景C：sourcePath获取失败

**症状：**
- findSourcePath 返回空字符串
- metadataCache.getFirstLinkpathDest 返回null

**修复：**
```typescript
function getSourcePathReliable(leaf: any, plugin: XMindPlugin): string {
  // 方式1：直接从leaf获取
  if (leaf.view.file) {
    return leaf.view.file.path;
  }
  
  // 方式2：从DOM的data-path属性
  const dataPath = leaf.view.containerEl?.getAttribute("data-path");
  if (dataPath) {
    return dataPath;
  }
  
  // 方式3：从active leaf
  const activeLeaf = plugin.app.workspace.activeLeaf;
  if (activeLeaf?.view?.file) {
    return activeLeaf.view.file.path;
  }
  
  return "";
}
```

---

## 总结

如果诊断确认了问题，记录以下信息供修复使用：

- [ ] Reading View中的实际HTML结构
- [ ] 容器元素的实际类名
- [ ] embed元素的实际类型和属性
- [ ] postProcessor是否被调用
- [ ] MutationObserver是否工作
- [ ] sourcePath是否可用

这些信息将直接指导修复方案的设计。
