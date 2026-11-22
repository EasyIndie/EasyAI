# 前端 UI 约定

这份约定适用于 `oneapi-gateway/chat-ui`（自研前端）与 `oneapi-gateway/src/ui.ts` 里的服务端渲染页面。新增页面时，优先复用 `oneapi-gateway/shared-ui` 中的组件和样式（或 `ui-shell.ts` 的导航/主题脚本），不再在页面内单独定义一套视觉规则。

> 管理后台不再自研：密钥、预算、用量、日志统一使用 LiteLLM Admin UI（`/ui`，支持中文）。

## 1. 统一原则

- 所有页面使用同一套主题变量：亮色 / 暗黑由 `ThemeProvider` 和 `ThemeToggle` 控制。
- 所有表单、按钮、卡片、表格和布局块优先使用共享组件。
- 页面级 `style` 只允许用于局部尺寸、间距或临时覆盖，不允许承载整页布局。
- 新增页面必须先检查是否能复用 `Page / Section / Field / ActionBar / Grid / Stack / Inline`。

## 2. 共享组件

### 基础交互

- `Button`：统一按钮外观与状态
- `Input`：统一输入框
- `Select`：统一下拉选择
- `TextArea`：统一多行输入
- `ThemeToggle`：统一主题切换

### 内容容器

- `Card`：信息卡、设置卡、结果卡
- `Table`：列表、统计表、管理表
- `Section`：页面块、表单区、状态区、结果区

### 字段与布局

- `Field`：标签 + 控件 + 提示信息
- `ActionBar`：操作按钮条、筛选条、分页条
- `Page`：页面根容器
- `Center`：居中登录页 / 空状态
- `Stack`：垂直堆叠
- `Inline`：水平排列
- `Grid`：响应式网格

## 3. 页面写法

### 推荐结构

```tsx
<Page className="ui-shell">
  <Section title="标题" description="说明">
    <ActionBar>
      <Field label="筛选条件">
        <Input />
      </Field>
      <Button variant="secondary">刷新</Button>
    </ActionBar>
    <Card>...</Card>
  </Section>
</Page>
```

### 常见约定

- 表单字段一律使用 `Field`，不要手写 `label + input` 的散装结构。
- 多按钮区域一律使用 `ActionBar`，不要在页面里自己拼一套按钮间距。
- 列表、统计卡、结果区优先用 `Grid + Card` 或 `Table`，不要用自定义多层 `div`。
- 空状态、登录页优先用 `Center` + `Section`。

## 4. 主题与样式

- 颜色、边框、阴影、字号、圆角、控件高度统一来自 `shared-ui/src/styles.css`。
- 新颜色优先加到 CSS 变量，不要在页面里硬编码一组新色值。
- 响应式优先依赖共享断点和共享布局类，不要为单个页面重新定义断点。

## 5. 新增页面检查清单

- 是否复用了共享组件，而不是新增本地样式组件
- 是否把页面级布局收敛到 `Page / Section / Grid / ActionBar`
- 是否避免了新的硬编码颜色、字体、边距体系
- 是否支持亮色 / 暗黑模式
- 是否在窄屏下仍然可用

## 6. 默认选择

- 聊天页优先使用：`Section`、`Field`、`ActionBar`、`Stack`
- 服务端渲染页（首页）使用 `ui-shell.ts` 的 `buildGlobalNav` + 主题脚本，保持导航和暗色模式一致

如果必须例外，先把例外写进 `shared-ui`，再在页面里使用，不要在业务页分叉出独立规范。
