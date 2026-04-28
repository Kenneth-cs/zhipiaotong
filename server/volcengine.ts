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

const ARK_API_KEY = 'ark-0ca54154-d3ff-49d9-a45b-a598b1759586-2a663';
const ARK_MODEL = 'deepseek-v3-2-251201';
const ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/responses';

export type InvoiceSubType =
  | 'FULLY_ELECTRONIC'      // 全电发票（全面数字化电子发票）
  | 'VAT_SPECIAL'           // 增值税专用发票（非全电）
  | 'VAT_ELECTRONIC'        // 增值税电子普通发票（非全电）
  | 'REFINED_OIL'           // 成品油增值税发票（非全电，特殊版面）
  | 'PAPER_GENERAL'         // 纸质普通发票
  | 'UNKNOWN';              // 无法判断

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

/**
 * 调用火山引擎大模型 (多模态) 直接识别发票图片
 */
export async function recognizeInvoice(imageBase64: string): Promise<OcrResult> {
  // 1. 先调用火山引擎的智能文档解析接口提取带版面结构的 Markdown 文本
  const t0 = Date.now();
  const ocrResult = await callSmartDocumentParse(imageBase64);
  const ocrMs = Date.now() - t0;
  
  if (!ocrResult.success || !ocrResult.rawJson) {
    return ocrResult; // OCR 阶段失败直接返回
  }

  // 获取 OCR 提取的 Markdown 文本
  const rawText = ocrResult.rawJson.data?.markdown || '';

  if (!rawText) {
    return { success: false, error: "未能从图片中提取到任何文本", rawJson: ocrResult.rawJson };
  }

  console.log(`⏱️ OCRPdf 耗时: ${ocrMs}ms`);

  // 2. 构造给大模型的 Prompt
  const prompt = `你是一个专业的中国增值税发票财务解析专家。
以下是通过智能文档解析（OCR）从发票上扫描出来的 Markdown 格式文本。
该文本保留了发票的原始版面结构和表格信息。
请你理解 Markdown 的表格结构和语义上下文，并精准提取出以下发票信息。

【提取字段与规则严格要求】：
1. invoiceCategory（发票分类）：判断是“数电发票”、“电子发票”还是“纸质发票”。
2. invoiceType（发票类型）：判断是“专票”还是“普票”。
3. buyerName（购买方名称）：购买商品或服务的一方。请仔细分析表格结构，通常在“购买方”或“受票方”栏目内。必须准确，绝不能与销售方弄反！
4. buyerTaxId（购买方税号）：18位统一社会信用代码。
5. sellerName（销售方名称）：开具发票的一方（如某某酒店、某某科技公司）。通常在“销售方”或“开票方”栏目内，或者在发票底部盖章处。
6. sellerTaxId（销售方税号）：18位统一社会信用代码。
7. invoiceCode（发票代码）：通常为 10-12 位纯数字。全电发票可能为空。
8. invoiceNumber（发票号码）：通常为 8 或 20 位数字。
9. invoiceDate（开票日期）：格式化为 YYYY年MM月DD日。
10. invoiceItem（开票项目）：货物或应税劳务、服务名称。请从 Markdown 表格的明细行中提取。如果带星号（如 *餐饮服务*餐饮），请保留。如果有多个明细，请合并或提取主要的。
11. amount（不含税金额）：数字类型。请从“金额”列或“合计”行提取。
12. tax（税额）：数字类型。请从“税额”列或“合计”行提取。
13. total（价税合计）：数字类型，必须等于 amount + tax。通常在“价税合计（大写/小写）”栏目。
14. remark（备注）：发票右下角的备注信息，没有则为空。

【特殊情况处理】：
- 如果原始文本中确实缺失某项数据，请将其值设为空字符串 ""（对于数字字段设为 0），切勿编造。
- 请直接返回符合上述字段的合法 JSON，不要包含任何多余的 Markdown 标记（如 \`\`\`json）或解释说明。
- 返回的 JSON 对象最外层必须包含上述所有 key。

【发票 Markdown 原始文本】：
${rawText}`;

  const payload = {
    model: ARK_MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt
          }
        ]
      }
    ]
  };

  try {
    const t1 = Date.now();
    const response = await fetch(ARK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ARK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const json = await response.json();
    const llmMs = Date.now() - t1;
    console.log(`⏱️ 大模型(${ARK_MODEL}) 耗时: ${llmMs}ms`);

    if (!response.ok) {
      return { 
        success: false, 
        error: json.error?.message || `大模型 HTTP错误: ${response.status}`, 
        rawJson: json 
      };
    }

    // 从 /api/v3/responses 格式提取文本
    let resultText = '';
    if (json.output && Array.isArray(json.output)) {
      const messageObj = json.output.find((o: any) => o.type === 'message' && o.role === 'assistant');
      if (messageObj?.content) {
        const textObj = messageObj.content.find((c: any) => c.type === 'output_text');
        if (textObj) resultText = textObj.text;
      }
    }
    
    if (!resultText) {
      return { success: false, error: "未从模型返回中提取到结构化JSON", rawJson: json };
    }

    // 清理可能的 Markdown 代码块包裹
    resultText = resultText.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    const parsedData = JSON.parse(resultText);

    // 补充 invoiceSubType
    let subType: InvoiceSubType = 'UNKNOWN';
    if (!parsedData.invoiceCode) {
      subType = 'FULLY_ELECTRONIC';
    } else {
      if (parsedData.invoiceItem?.includes('成品油') || parsedData.invoiceItem?.includes('汽油')) {
        subType = 'REFINED_OIL';
      } else if (parsedData.invoiceType === '专票') {
        subType = 'VAT_SPECIAL';
      } else if (parsedData.invoiceType === '普票') {
        subType = 'VAT_ELECTRONIC';
      }
    }
    parsedData.invoiceSubType = subType;

    console.log('🤖 大模型解析结果:', JSON.stringify(parsedData, null, 2));

    return {
      success: true,
      data: parsedData,
      rawJson: json
    };

  } catch (error: any) {
    console.error('🔥 大模型请求异常:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 基础 OCR：调用火山引擎智能文档解析 (OCRPdf) 提取带版面结构和表格的 Markdown 文本
 */
async function callSmartDocumentParse(imageBase64: string): Promise<OcrResult> {
  const signed = buildSignedRequest('OCRPdf', '2021-08-23', {
    image_base64: imageBase64,
    version: 'v3' // 必须指定 v3 才能返回 markdown 等高级结构
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
    const errMsg = json.ResponseMetadata?.Error?.Message || `HTTP ${response.status}`;
    return { success: false, error: errMsg, rawJson: json };
  }

  return { success: true, rawJson: json };
}
