import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const ACCESS_KEY_ID = process.env.VOLC_ACCESS_KEY_ID || '';
const SECRET_ACCESS_KEY = process.env.VOLC_SECRET_ACCESS_KEY || '';
const REGION = 'cn-north-1';
const SERVICE = 'cv';
const HOST = 'visual.volcengineapi.com';
const ENDPOINT = `https://${HOST}`;

// ========== 火山引擎 V4 签名实现 ==========

function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function getSignatureKey(secretKey: string, date: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(secretKey, date);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'request');
  return kSigning;
}

function formatUTCDate(date: Date): { xDate: string; shortDate: string } {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return {
    xDate: `${year}${month}${day}T${hours}${minutes}${seconds}Z`,
    shortDate: `${year}${month}${day}`,
  };
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function buildSignedRequest(
  action: string,
  version: string,
  bodyParams: Record<string, string>
): SignedRequest {
  const now = new Date();
  const { xDate, shortDate } = formatUTCDate(now);

  // Query 参数
  const queryParams = new URLSearchParams({
    Action: action,
    Version: version,
  });
  queryParams.sort();
  const canonicalQueryString = queryParams.toString();

  // Body（application/x-www-form-urlencoded）
  const bodyString = new URLSearchParams(bodyParams).toString();

  // 请求头
  const contentType = 'application/x-www-form-urlencoded';
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Host': HOST,
    'X-Date': xDate,
  };

  // 1. 创建规范请求
  const signedHeaders = 'content-type;host;x-date';
  const canonicalHeaders = `content-type:${contentType}\nhost:${HOST}\nx-date:${xDate}\n`;
  const canonicalRequest = [
    'POST',
    '/',
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    sha256(bodyString),
  ].join('\n');

  // 2. 创建待签名字符串
  const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');

  // 3. 计算签名
  const signingKey = getSignatureKey(SECRET_ACCESS_KEY, shortDate, REGION, SERVICE);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  // 4. 构建 Authorization
  const authorization = `HMAC-SHA256 Credential=${ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  headers['Authorization'] = authorization;

  return {
    url: `${ENDPOINT}/?${canonicalQueryString}`,
    headers,
    body: bodyString,
  };
}

// ========== OCR 识别接口 ==========

export interface OcrResult {
  success: boolean;
  data?: {
    invoiceCode?: string;
    invoiceNumber?: string;
    invoiceDate?: string;
    amount?: number;
    tax?: number;
    total?: number;
    sellerName?: string;
    sellerTaxId?: string;
    buyerName?: string;
    buyerTaxId?: string;
    invoiceCategory?: string;    // 发票分类：数电发票 / 电子发票 / 纸质发票
    invoiceType?: string;        // 发票类型：普票 / 专票
    invoiceSubType?: string;     // 精细子类型：FULLY_ELECTRONIC / VAT_SPECIAL / VAT_ELECTRONIC / REFINED_OIL / PAPER_GENERAL
    invoiceItem?: string;        // 开票项目（货物/服务类别，已清洗 * 前缀）
    invoiceDetail?: string;      // 开票明细（完整明细行）
    remark?: string;             // 备注信息
    oilQuantity?: number;        // 成品油：数量（升），仅 REFINED_OIL 类型有值
    oilUnitPrice?: number;       // 成品油：单价（元/升），仅 REFINED_OIL 类型有值
  };
  rawJson?: any;
  error?: string;
}

/**
 * 调用火山引擎 OCR 识别发票
 * 使用 MultiLanguageOCR + 智能解析器提取发票字段
 */
export async function recognizeInvoice(imageBase64: string): Promise<OcrResult> {
  return callMultiLanguageOCR(imageBase64);
}

/**
 * 多语种OCR
 * Action: MultiLanguageOCR / Version: 2022-08-31
 */
async function callMultiLanguageOCR(imageBase64: string): Promise<OcrResult> {
  const signed = buildSignedRequest('MultiLanguageOCR', '2022-08-31', {
    image_base64: imageBase64,
  });

  const response = await fetch(signed.url, {
    method: 'POST',
    headers: signed.headers,
    body: signed.body,
  });

  const json = await response.json();

  // 检查业务错误码
  if (json.code && json.code !== 10000) {
    return { success: false, error: json.message || `业务错误 ${json.code}`, rawJson: json };
  }

  if (!response.ok || json.ResponseMetadata?.Error) {
    const errMsg = json.ResponseMetadata?.Error?.Message || `HTTP ${response.status}`;
    return { success: false, error: errMsg, rawJson: json };
  }

  // 多语种OCR返回 data.ocr_infos 数组
  const ocrInfos = json.data?.ocr_infos || [];
  const lines: string[] = ocrInfos
    .map((line: any) => line.text || '')
    .filter((t: string) => t.trim());

  console.log(`📝 OCR识别到 ${lines.length} 行文字`);
  lines.forEach((line: string, i: number) => console.log(`  ${i + 1}: ${line}`));

  const fullText = lines.join('\n');
  const parsed = parseInvoiceText(fullText, lines);

  return {
    success: true,
    data: parsed,
    rawJson: json,
  };
}

// ========== 发票类型识别（系统规则，无需额外 AI 调用）==========

export type InvoiceSubType =
  | 'FULLY_ELECTRONIC'      // 全电发票（全面数字化电子发票）
  | 'VAT_SPECIAL'           // 增值税专用发票（非全电）
  | 'VAT_ELECTRONIC'        // 增值税电子普通发票（非全电）
  | 'REFINED_OIL'           // 成品油增值税发票（非全电，特殊版面）
  | 'PAPER_GENERAL'         // 纸质普通发票
  | 'UNKNOWN';              // 无法判断

/**
 * 根据 OCR 提取的原始文字判断发票子类型。
 * 判断依据：
 *   1. 有"发票代码"字段（8-12位纯数字）→ 非全电发票，进一步细分
 *      - 含"成品油"/"升"/"元/升" → REFINED_OIL
 *      - 含"增值税专用发票"       → VAT_SPECIAL
 *      - 其他                    → VAT_ELECTRONIC
 *   2. 无"发票代码" → FULLY_ELECTRONIC（全电）
 * 纯正则，耗时 <1ms，零额外 API 成本。
 */
export function detectInvoiceType(fullText: string): InvoiceSubType {
  const hasInvoiceCode = /发票代码[：:]*\s*\d{8,12}/.test(fullText);

  if (!hasInvoiceCode) {
    return 'FULLY_ELECTRONIC';
  }

  // 非全电：按版面关键词细分
  if (/成品油|元\/升|[升][^以]/.test(fullText)) {
    return 'REFINED_OIL';
  }
  if (/增值税专用发票/.test(fullText)) {
    return 'VAT_SPECIAL';
  }
  if (/增值税.*普通发票|电子.*普通发票/.test(fullText)) {
    return 'VAT_ELECTRONIC';
  }
  // 有发票代码但未匹配到以上特征，归为纸质普通发票
  return 'PAPER_GENERAL';
}

/**
 * 从 OCR 文本中解析发票字段
 * @param fullText 所有行拼接的完整文本
 * @param lines 每行文本数组（保留顺序用于上下文判断）
 */
function parseInvoiceText(fullText: string, lines: string[] = []) {
  // ── 步骤0：前置类型识别 ──────────────────────────────────────────────────
  const subType = detectInvoiceType(fullText);
  console.log(`🧾 发票类型识别：${subType}`);

  const extract = (patterns: RegExp[]): string => {
    for (const p of patterns) {
      const match = fullText.match(p);
      if (match && match[1]) return match[1].trim();
    }
    return '';
  };

  const extractNum = (patterns: RegExp[]): number => {
    const str = extract(patterns);
    const num = parseFloat(str.replace(/,/g, ''));
    return isNaN(num) ? 0 : num;
  };

  // 发票号码
  const invoiceNumber = extract([
    /发票号码[：:]*\s*(\d{8,30})/,
    /No[.：:]*\s*(\d{8,30})/i,
  ]);

  // 发票代码：全电发票无此字段；非全电有 8-12 位代码
  const invoiceCode = extract([
    /发票代码[：:]*\s*(\d{8,12})/,
  ]);

  // 开票日期
  const invoiceDate = extract([
    /开票日期[：:]*\s*(\d{4}[年\-\/]\d{1,2}[月\-\/]\d{1,2}日?)/,
    /日期[：:]*\s*(\d{4}[年\-\/]\d{1,2}[月\-\/]\d{1,2}日?)/,
  ]);

  // 价税合计：精确匹配"(小写)¥XXXX.XX"格式，避免误匹配表格内其他¥行
  const total = extractNum([
    /[（(]小写[)）][¥￥]\s*([\d,]+\.\d{2})/,
    /价税合计[^¥￥]*[¥￥]\s*([\d,]+\.\d{2})/,
  ]);

  // 合计金额和税额：从独立的 "¥XXXX.XX" 行中提取（合计行通常单独成行）
  const amountLines: number[] = [];
  for (const line of lines) {
    const m = line.match(/^[¥￥]\s*([\d,]+\.\d{2})$/);
    if (m) {
      amountLines.push(parseFloat(m[1].replace(/,/g, '')));
    }
  }

  let amount = 0;
  let tax = 0;

  if (amountLines.length >= 2) {
    // 税额永远小于金额，用大小关系判断，不依赖OCR输出顺序
    const sorted = [...amountLines].sort((a, b) => b - a);
    amount = sorted[0]; // 最大值 = 不含税金额
    tax = sorted[1];    // 次大值 = 税额
  } else {
    // 回退方案：从合计行附近提取
    amount = extractNum([
      /合[\s\n]*计[\s\S]*?[¥￥]\s*([\d,]+\.\d{2})/,
      /金额[\s\S]*?([\d,]+\.\d{2})/,
    ]);
    tax = extractNum([
      /税额[\s\S]*?[¥￥]?\s*([\d,]+\.\d{2})/,
    ]);
  }

  // 价税合计 = 金额 + 税额（如正则未能提取到，则自动计算）
  const finalTotal = total || (amount + tax > 0 ? parseFloat((amount + tax).toFixed(2)) : 0);

  // ===== 购买方 / 销售方解析（标签锚点法）=====
  // 中国增值税发票有法定版式，"购买方"/"销售方"是强制标注字段。
  // 以这两个标签在 lines 数组中的位置为锚点，分别在各自区段内提取名称和税号，
  // 不依赖 OCR 行的绝对顺序，从根本上避免购销方对调。
  let buyerName = '';
  let sellerName = '';
  let buyerTaxId = '';
  let sellerTaxId = '';

  const TAX_ID_RE = /(?:统一社会信用代码|纳税人识别号)[/／]*(?:纳税人识别号)?[：:]\s*([A-Za-z0-9]{15,20})/;
  const NAME_RE   = /^名称[：:](.+)/;

  // 找到"购买方"和"销售方"标签所在行的下标
  const buyerLabelIdx  = lines.findIndex(l => /购买方/.test(l));
  const sellerLabelIdx = lines.findIndex(l => /销售方/.test(l));

  /**
   * 在 lines[start..end) 区段内提取第一个匹配 re 的捕获组
   */
  function extractInRange(re: RegExp, start: number, end: number): string {
    for (let i = start; i < end; i++) {
      // 同一行可能包含标签和值（如"购买方名称：xxx"），也处理跨行情况
      const combined = lines[i];
      const m = combined.match(re);
      if (m && m[1]) return m[1].trim();
    }
    return '';
  }

  if (buyerLabelIdx >= 0 && sellerLabelIdx >= 0) {
    // 正常情况：两个标签都找到，按区段提取
    const buyerEnd  = sellerLabelIdx;          // 购买方区段：buyerLabelIdx ~ sellerLabelIdx
    const sellerEnd = lines.length;            // 销售方区段：sellerLabelIdx ~ 末尾

    buyerName   = extractInRange(NAME_RE,   buyerLabelIdx,  buyerEnd);
    buyerTaxId  = extractInRange(TAX_ID_RE, buyerLabelIdx,  buyerEnd);
    sellerName  = extractInRange(NAME_RE,   sellerLabelIdx, sellerEnd);
    sellerTaxId = extractInRange(TAX_ID_RE, sellerLabelIdx, sellerEnd);

    // 兜底：若名称行格式为"购买方名称：xxx"（标签与值合并在同一行）
    if (!buyerName) {
      const m = lines[buyerLabelIdx]?.match(/购买方.*名称[：:](.+)/);
      if (m) buyerName = m[1].trim();
    }
    if (!sellerName) {
      const m = lines[sellerLabelIdx]?.match(/销售方.*名称[：:](.+)/);
      if (m) sellerName = m[1].trim();
    }
  } else {
    // 降级：标签未找到（极少数异常发票），按出现顺序回退，并在前端标记待复核
    const nameLines:  string[] = [];
    const taxIdLines: string[] = [];
    for (const line of lines) {
      const nm = line.match(NAME_RE);
      if (nm) nameLines.push(nm[1].trim());
      const tm = line.match(TAX_ID_RE);
      if (tm) taxIdLines.push(tm[1].trim());
    }
    buyerName   = nameLines[0]   || '';
    sellerName  = nameLines[1]   || '';
    buyerTaxId  = taxIdLines[0]  || '';
    sellerTaxId = taxIdLines[1]  || '';
    console.warn('⚠️  未找到购买方/销售方标签，已降级为顺序匹配，建议人工复核');
  }

  // ===== 发票分类（数电发票 / 电子发票 / 纸质发票）=====
  let invoiceCategory = '纸质发票';
  if (fullText.includes('数字化电子发票') || fullText.includes('数电发票')) {
    invoiceCategory = '数电发票';
  } else if (fullText.includes('电子发票')) {
    invoiceCategory = '电子发票';
  }

  // ===== 发票类型（普票 / 专票）=====
  let invoiceType = '';
  if (fullText.includes('增值税专用发票') || fullText.includes('专用发票')) {
    invoiceType = '专票';
  } else if (fullText.includes('普通发票') || fullText.includes('电子发票')) {
    invoiceType = '普票';
  }

  // ===== 开票项目（*类别*商品名，清洗 * 前缀后入库）=====
  let invoiceItem = '';
  const itemMatch = fullText.match(/\*([^*]+)\*([^*\n]+)/);
  if (itemMatch) {
    // 非全电成品油发票货物名称形如 *汽油*95号车用汽油(VIB)，清洗 * 后展示
    const cleaned = `${itemMatch[1].trim()} ${itemMatch[2].trim()}`.replace(/\*/g, '').trim();
    invoiceItem = subType === 'REFINED_OIL' ? cleaned : `*${itemMatch[1]}*${itemMatch[2].trim()}`;
  }

  // ===== 开票明细（收集所有含金额的明细行）=====
  let invoiceDetail = '';
  const detailLines: string[] = [];
  for (const line of lines) {
    if (/^\*/.test(line) || /[\d.]+\s*\/\s*[\d.]/.test(line)) {
      detailLines.push(line);
    }
  }
  if (detailLines.length > 0) {
    invoiceDetail = detailLines.join('\n');
  }

  // ===== 成品油专属字段（升数、单价，仅 REFINED_OIL 类型提取）=====
  let oilQuantity = 0;   // 数量（升）
  let oilUnitPrice = 0;  // 单价（元/升）
  if (subType === 'REFINED_OIL') {
    oilQuantity  = extractNum([/数量[：:]*\s*([\d.]+)\s*升?/, /升\s*([\d.]+)/]);
    oilUnitPrice = extractNum([/单价[（(]元\/升[)）][：:]*\s*([\d.]+)/, /元\/升[：:]*\s*([\d.]+)/]);
  }

  // ===== 备注信息 =====
  const remark = extract([
    /备注[：:]\s*(.+)/,
    /备\s*注[：:]\s*(.+)/,
  ]);

  const result = {
    invoiceCode,
    invoiceNumber,
    invoiceDate,
    amount,
    tax,
    total: finalTotal,
    sellerName,
    sellerTaxId,
    buyerName,
    buyerTaxId,
    invoiceCategory,
    invoiceType,
    invoiceSubType: subType,   // 新增：精细类型，供前端展示/调试
    invoiceItem,
    invoiceDetail,
    remark,
    // 成品油扩展字段（非成品油发票为 0，前端可按 invoiceSubType 决定是否展示）
    ...(subType === 'REFINED_OIL' && { oilQuantity, oilUnitPrice }),
  };

  console.log('📊 解析结果:', JSON.stringify(result, null, 2));
  return result;
}