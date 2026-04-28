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

  const queryParams = new URLSearchParams({ Action: action, Version: version });
  queryParams.sort();
  const canonicalQueryString = queryParams.toString();

  const bodyString = new URLSearchParams(bodyParams).toString();

  const contentType = 'application/x-www-form-urlencoded';
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Host': HOST,
    'X-Date': xDate,
  };

  const signedHeaders = 'content-type;host;x-date';
  const canonicalHeaders = `content-type:${contentType}\nhost:${HOST}\nx-date:${xDate}\n`;
  const canonicalRequest = [
    'POST', '/', canonicalQueryString, canonicalHeaders, signedHeaders, sha256(bodyString),
  ].join('\n');

  const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, sha256(canonicalRequest)].join('\n');

  const signingKey = getSignatureKey(SECRET_ACCESS_KEY, shortDate, REGION, SERVICE);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers['Authorization'] = `HMAC-SHA256 Credential=${ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: `${ENDPOINT}/?${canonicalQueryString}`, headers, body: bodyString };
}

// ========== 大模型（兜底用） ==========
const ARK_API_KEY = 'ark-0ca54154-d3ff-49d9-a45b-a598b1759586-2a663';
const ARK_MODEL = 'deepseek-v3-2-251201';
const ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/responses';

export type InvoiceSubType =
  | 'FULLY_ELECTRONIC'
  | 'VAT_SPECIAL'
  | 'VAT_ELECTRONIC'
  | 'REFINED_OIL'
  | 'PAPER_GENERAL'
  | 'UNKNOWN';

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
    invoiceCategory?: string;
    invoiceType?: string;
    invoiceSubType?: string;
    invoiceItem?: string;
    invoiceDetail?: string;
    remark?: string;
    oilQuantity?: number;
    oilUnitPrice?: number;
  };
  rawJson?: any;
  error?: string;
}

// ========== 大模型解析 ==========

function buildSubType(invoiceCode: string, invoiceType: string, invoiceItem: string): InvoiceSubType {
  if (!invoiceCode) return 'FULLY_ELECTRONIC';
  if (invoiceItem?.includes('成品油') || invoiceItem?.includes('汽油')) return 'REFINED_OIL';
  if (invoiceType === '专票') return 'VAT_SPECIAL';
  if (invoiceType === '普票') return 'VAT_ELECTRONIC';
  return 'UNKNOWN';
}

async function callLLMParse(rawText: string): Promise<OcrResult> {
  const prompt = `你是一个专业的中国增值税发票财务解析专家。
以下是通过智能文档解析（OCR）从发票上扫描出来的 Markdown 格式文本，保留了版面结构和表格信息。
请精准提取以下发票信息，直接返回合法 JSON，不要包含 \`\`\`json 或任何解释说明。

字段：invoiceCategory（数电发票/电子发票/纸质发票）、invoiceType（专票/普票）、
buyerName、buyerTaxId（18位）、sellerName、sellerTaxId（18位）、
invoiceCode（10-12位数字，全电为空""）、invoiceNumber、invoiceDate（YYYY年MM月DD日）、
invoiceItem（保留*号格式，多条用顿号合并）、amount（数字）、tax（数字）、total（数字）、remark。
缺失字段设为""或0，禁止编造。

【发票 Markdown】：
${rawText}`;

  const payload = {
    model: ARK_MODEL,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }]
  };

  try {
    const t1 = Date.now();
    const response = await fetch(ARK_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ARK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await response.json();
    console.log(`⏱️ 大模型兜底(${ARK_MODEL}) 耗时: ${Date.now() - t1}ms`);

    if (!response.ok) {
      return { success: false, error: json.error?.message || `大模型 HTTP错误: ${response.status}`, rawJson: json };
    }

    let resultText = '';
    if (json.output && Array.isArray(json.output)) {
      const msgObj = json.output.find((o: any) => o.type === 'message' && o.role === 'assistant');
      if (msgObj?.content) {
        const textObj = msgObj.content.find((c: any) => c.type === 'output_text');
        if (textObj) resultText = textObj.text;
      }
    }
    if (!resultText) return { success: false, error: "未从模型返回中提取到结构化JSON", rawJson: json };

    resultText = resultText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    const parsedData = JSON.parse(resultText);
    parsedData.invoiceSubType = buildSubType(parsedData.invoiceCode, parsedData.invoiceType, parsedData.invoiceItem);

    console.log('🤖 大模型兜底解析结果:', JSON.stringify(parsedData, null, 2));
    return { success: true, data: parsedData, rawJson: json };
  } catch (error: any) {
    console.error('🔥 大模型请求异常:', error);
    return { success: false, error: error.message };
  }
}

// ========== 主入口 ==========

/**
 * 识别发票：OCRPdf 提取 Markdown（~1s）→ 大模型解析（~6-8s）
 */
export async function recognizeInvoice(imageBase64: string): Promise<OcrResult> {
  // Step 1: OCRPdf 提取结构化 Markdown
  const t0 = Date.now();
  const ocrResult = await callSmartDocumentParse(imageBase64);
  console.log(`⏱️ OCRPdf 耗时: ${Date.now() - t0}ms`);

  if (!ocrResult.success || !ocrResult.rawJson) return ocrResult;

  const rawText = ocrResult.rawJson.data?.markdown || '';
  if (!rawText) return { success: false, error: "未能从图片中提取到任何文本", rawJson: ocrResult.rawJson };

  // 直接走大模型解析
  return callLLMParse(rawText);
}

/**
 * 调用火山引擎 OCRPdf 智能文档解析，返回带版面结构的 Markdown
 */
async function callSmartDocumentParse(imageBase64: string): Promise<OcrResult> {
  const signed = buildSignedRequest('OCRPdf', '2021-08-23', {
    image_base64: imageBase64,
    version: 'v3'
  });

  const response = await fetch(signed.url, {
    method: 'POST',
    headers: signed.headers,
    body: signed.body,
  });

  const json = await response.json();

  if (json.code && json.code !== 10000) {
    return { success: false, error: json.message || `业务错误 ${json.code}`, rawJson: json };
  }
  if (!response.ok || json.ResponseMetadata?.Error) {
    return { success: false, error: json.ResponseMetadata?.Error?.Message || `HTTP ${response.status}`, rawJson: json };
  }

  return { success: true, rawJson: json };
}
