# 智票通 SmartInvoice

企业发票批量OCR识别、智能去重、一键导出Excel的Web工具。

---

## 项目架构

```
SmartInvoice_智票通/
├── server/                  # Node.js 后端（Express）
│   ├── index.ts             # 服务入口，挂载路由
│   ├── volcengine.ts        # 火山引擎 OCR 核心调用 + 发票字段解析
│   ├── db.ts                # MySQL 连接池
│   ├── upload.ts            # multer 文件上传中间件
│   ├── init.sql             # 数据库初始化脚本
│   ├── middleware/
│   │   └── auth.ts          # JWT 鉴权中间件
│   └── routes/
│       ├── auth.ts          # 注册/登录接口
│       ├── ocr.ts           # OCR 识别接口（核心）
│       └── invoices.ts      # 发票历史CRUD接口
├── src/                     # React 前端
│   └── ...
├── .env                     # 环境变量（勿上传git）
├── package.json
└── PRD.md                   # 产品需求文档
```

---

## 环境变量配置（.env）

```env
# 火山引擎 API 凭证（在火山引擎控制台 → 访问密钥 获取）
VOLC_ACCESS_KEY_ID=你的AccessKeyId
VOLC_SECRET_ACCESS_KEY=你的SecretAccessKey

# OCR 并发限流（默认每次间隔1.1秒，防止超QPS）
VOLC_OCR_CONCURRENT=1
VOLC_OCR_MIN_INTERVAL=1100

# 服务端口
SERVER_PORT=3001

# MySQL 数据库
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_NAME=smart_invoice

# JWT 密钥（随机字符串即可）
JWT_SECRET=your_random_secret
```

---

## 启动方法

### 1. 初始化数据库
```bash
mysql -u root -p < server/init.sql
```

### 2. 安装依赖
```bash
npm install
```

### 3. 同时启动前端+后端
```bash
npm run dev:all
```
- 前端访问：http://localhost:3000
- 后端API：http://localhost:3001

---

## OCR 核心接口

### POST /api/ocr/recognize

识别单张发票文件，返回结构化字段 + 去重状态。

**请求（multipart/form-data）：**

| 字段 | 类型 | 说明 |
|---|---|---|
| file | File | 发票文件，支持 JPG/PNG/PDF |
| batchId | string | 本次批量上传的批次ID（用于批次内去重） |

**响应示例：**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "fileName": "发票.pdf",
    "invoiceCode": "044031900111",
    "invoiceNumber": "12345678",
    "invoiceDate": "2024年01月15日",
    "amount": 1000.00,
    "tax": 130.00,
    "total": 1130.00,
    "sellerName": "XX科技有限公司",
    "buyerName": "YY集团",
    "taxId": "91310000xxxxxxxx",
    "status": "normal",
    "isDuplicate": false
  }
}
```

---

## OCR 技术说明

- **使用接口**：火山引擎 `MultiLanguageOCR`（多语种通用OCR）
- **接口文档**：https://www.volcengine.com/docs/86081/1660264
- **识别流程**：
  1. 发票图片/PDF → Base64编码
  2. 调用火山引擎 MultiLanguageOCR → 返回文字行数组
  3. 本地正则解析器从文字中提取：发票号码、日期、金额、税额、购销双方名称等
- **去重逻辑**：基于「发票代码 + 发票号码」组合唯一性，同时对比批次内和历史数据库

---

## 注意事项

1. **图片限制**：最小 256×256 像素，最大 2048×2048 像素，文件不超过 8MB
2. **PDF 限制**：多页PDF默认只识别第一页
3. **限流**：火山引擎OCR有QPS限制，系统已内置每次请求间隔1.1秒的限流保护
4. **精度说明**：MultiLanguageOCR 是通用OCR，通过正则解析发票字段，对于非标准格式发票可能需要手动修正

---

## 当前已知问题与改进方向

- [ ] 当发票图片分辨率低或倾斜时，OCR识别率会下降，可考虑接入图像预处理
- [ ] PDF多页发票目前只识别第一页，后续可增加多页合并识别
- [ ] 可考虑引入AI大模型（如Gemini）对OCR原始文本做二次语义理解，提升字段提取准确率

---

## 识别准确性优化计划（V1.1）

经38张发票实测发现以下问题，已规划修复方案（详见 [PRD.md 第6节](./PRD.md)）：

### 问题一：非全电发票识别有误

旧式增值税电子普通发票（含成品油）版面与全电发票差异大，字段解析出错。

**修复方案：发票类型分类前置 + 分支解析**

- **分类方式**：系统正则规则（非 AI），OCR 文字提取后即判断，耗时 <1ms、零额外成本
- **判断依据**：是否存在"发票代码"字段（8/10位纯数字）+ 抬头关键词
- **分支逻辑**：

```
OCR文字 → 类型判断
  ├── 无发票代码 → 全电发票 → 现有解析逻辑
  └── 有发票代码 → 非全电发票
        ├── 含"成品油"/"升" → 成品油专用解析（清洗*前缀、提取升数单价）
        ├── 含"增值税专用发票" → 专票解析
        └── 其他 → 电子普通发票解析
```

- **改动文件**：`server/volcengine.ts`（新增 `detectInvoiceType()` + 分支解析函数）

### 问题二：购买方/销售方字段对调

部分发票 OCR 行序特殊，导致买卖双方身份被互换。

**修复方案：标签锚点解析 + LLM Prompt 强化**

- **措施1（主要）**：改用标签锚点解析，严格匹配"购买方"/"买方"、"销售方"/"卖方"文字标签，不再依赖行序位置
- **措施2（辅助）**：若后续引入 LLM，Prompt 中明确约束购销方以标签识别，不可依赖位置推断，并加入 Few-shot 示例
- **措施3（兜底）**：buyerTaxId / sellerTaxId 为空或相同时，前端自动标记 ⚠️ 待复核

> 白名单方案不适用于大量用户场景（多租户、无法统一维护），故不采用。

### 实施优先级

| 优先级 | 内容 | 文件 |
|--------|------|------|
| P0 | 标签锚点修复购销方对调 | `server/volcengine.ts` |
| P1 | 发票类型分类前置逻辑 | `server/volcengine.ts` |
| P2 | 非全电发票专属字段映射 | `server/volcengine.ts` |
| P3 | 前端可疑字段标记 | 前端列表组件 |
