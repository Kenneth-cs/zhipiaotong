import { OpenAI } from 'openai';
import { fromBuffer } from 'pdf2pic';
import dotenv from 'dotenv';

dotenv.config();

const QWEN_MODEL = 'qwen3-vl-flash'; // 推荐使用此模型
const OPENAI_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

const openai = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: OPENAI_BASE_URL,
});


// function formatUTCDate ... (已废弃)
// function buildSignedRequest ... (已废弃)

// ========== 大模型（兜底用） (已废弃) ==========
// const ARK_API_KEY = ...
// const ARK_MODEL = ...
// const ARK_ENDPOINT = ...

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
    totalChinese?: string;
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

function chineseToNumber(chinese: string): number | null {
  if (!chinese) return null;
  const numMap: Record<string, number> = { '零': 0, '壹': 1, '贰': 2, '叁': 3, '肆': 4, '伍': 5, '陆': 6, '柒': 7, '捌': 8, '玖': 9 };
  const unitMap: Record<string, number> = { '分': 0.01, '角': 0.1, '圆': 1, '元': 1, '拾': 10, '佰': 100, '百': 100, '仟': 1000, '千': 1000, '万': 10000, '亿': 100000000 };
  
  let result = 0;
  let temp = 0;
  let section = 0;
  
  for (let i = 0; i < chinese.length; i++) {
    const char = chinese[i];
    if (char === '整' || char === '正') continue;
    if (numMap[char] !== undefined) {
      temp = numMap[char];
    } else if (unitMap[char] !== undefined) {
      let unit = unitMap[char];
      if (unit >= 10000) {
        section = (section + (temp === 0 && result === 0 ? 1 : temp)) * unit;
        result += section;
        section = 0;
        temp = 0;
      } else if (unit >= 1) {
        section += (temp === 0 && unit === 10 ? 1 : temp) * unit;
        temp = 0;
      } else {
        result += temp * unit;
        temp = 0;
      }
    }
  }
  result += section + temp;
  return result === 0 ? null : Math.round(result * 100) / 100;
}

function financialSelfHealing(parsedData: any) {
  let { amount, tax, total, totalChinese } = parsedData;
  if (typeof amount !== 'number' || typeof tax !== 'number' || typeof total !== 'number') return;
  
  const chineseNum = chineseToNumber(totalChinese || '');
  if (chineseNum !== null && Math.abs(chineseNum - total) > 0.01) {
    // 兜底：中文大写转出来的数字如果不等于数字小写，且中文识别通常更准，则以中文为准
    // 注意：只在存在明显冲突时信任中文
    total = chineseNum;
    parsedData.total = total;
  }

  // 金额交叉验证
  const diff = Math.abs(amount + tax - total);
  if (diff <= 0.01) return; // 本来就是对的

  // 等式不成立，尝试 1 和 7 互换的组合
  const amountStr = amount.toString();
  const taxStr = tax.toString();

  // 把所有1换成7，7换成1的可能字符串变体找出来
  function getVariations(str: string) {
    const vars = [str];
    if (str.includes('1')) vars.push(str.replace(/1/g, '7'));
    if (str.includes('7')) vars.push(str.replace(/7/g, '1'));
    // 也可以考虑个别替换，但考虑到OCR往往是统一风格，这里只做简单全局替换
    return Array.from(new Set(vars)).map(s => parseFloat(s)).filter(n => !isNaN(n));
  }

  const amountVars = getVariations(amountStr);
  const taxVars = getVariations(taxStr);

  for (const a of amountVars) {
    for (const t of taxVars) {
      if (Math.abs(a + t - total) <= 0.01) {
        // 验证常见税率：1%, 3%, 6%, 9%, 13% 等
        // 只要税率在合理范围，就认为找出了正确的纠偏
        const rate = t / a;
        const validRates = [0.01, 0.03, 0.06, 0.09, 0.13];
        let isValidRate = false;
        for (const r of validRates) {
          if (Math.abs(rate - r) < 0.005) {
            isValidRate = true;
            break;
          }
        }
        
        if (isValidRate || a + t === total) { // 只要等式完美成立，就算纠偏成功
          console.log(`🔧 财务逻辑自愈: ${amount}+${tax}=${amount+tax} != ${total} -> 纠正为 ${a}+${t}=${total}`);
          parsedData.amount = a;
          parsedData.tax = t;
          return;
        }
      }
    }
  }
}

async function callQwenVLParse(imageBase64: string): Promise<OcrResult> {
  const prompt = `请从图片中提取以下发票字段内容，并直接以JSON格式返回，不要包含 \`\`\`json 或任何解释说明。
输出结构必须完全如下（缺失字段请填 "" 或 0）：
{
  "invoiceCategory": "数电发票/电子发票/纸质发票",
  "invoiceType": "专票/普票",
  "invoiceCode": "10-12位数字（全电发票为空）",
  "invoiceNumber": "发票号码",
  "invoiceDate": "YYYY年MM月DD日",
  "buyerName": "购买方名称",
  "buyerTaxId": "购买方统一社会信用代码/纳税人识别号（18位）",
  "sellerName": "销售方名称",
  "sellerTaxId": "销售方统一社会信用代码/纳税人识别号（18位）",
  "invoiceItem": "开票项目名称（如果是成品油发票请保留*号，多条用顿号合并）",
  "amount": 0.00,
  "tax": 0.00,
  "total": 0.00,
  "totalChinese": "价税合计的大写中文金额",
  "remark": "备注内容"
}

注意：
1. 务必通过"购买方"、"销售方"等文字标签锚点来精确提取购销双方名称和税号，绝不可看错或颠倒。
2. 仔细识别小数点，特别是金额中的 "1" 和 "7" 不要混淆。
`;

  try {
    const t1 = Date.now();
    console.log(`🤖 开始调用阿里云百炼 ${QWEN_MODEL} 视觉大模型...`);
    
    const completion = await openai.chat.completions.create({
      model: QWEN_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                // OpenAI 接口要求的 Base64 格式
                url: `data:image/png;base64,${imageBase64}`
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
      // @ts-ignore: extra_body for DashScope compatibility
      extra_body: {
        enable_thinking: false
      }
    });

    console.log(`⏱️ ${QWEN_MODEL} 耗时: ${Date.now() - t1}ms`);

    const messageContent = completion.choices[0]?.message?.content;
    if (!messageContent) {
      return { success: false, error: "模型返回内容为空", rawJson: completion };
    }

    let resultText = messageContent.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    const parsedData = JSON.parse(resultText);
    parsedData.invoiceSubType = buildSubType(parsedData.invoiceCode, parsedData.invoiceType, parsedData.invoiceItem);

    // 触发财务逻辑自愈层
    financialSelfHealing(parsedData);

    console.log('🤖 Qwen-VL 解析结果:', JSON.stringify(parsedData, null, 2));
    return { success: true, data: parsedData, rawJson: completion };
  } catch (error: any) {
    console.error('🔥 Qwen-VL 请求异常:', error.message || error);
    return { success: false, error: error.message || '大模型请求异常' };
  }
}

// ========== 主入口 ==========

/**
 * 识别发票：直接使用阿里云 Qwen-VL (如果是 PDF 则先转图片)
 */
export async function recognizeInvoice(fileBuffer: Buffer, mimetype: string): Promise<OcrResult> {
  let imageBase64 = '';

  try {
    if (mimetype === 'application/pdf') {
      console.log(`📄 检测到 PDF，正在使用 graphicsmagick 转为图片...`);
      const options = {
        density: 200, // DPI 稍微高点保持清晰
        saveFilename: "temp_page",
        savePath: "./uploads", // 这只是个缓存目录
        format: "png",
        width: 1600,
      };
      const convert = fromBuffer(fileBuffer, options);
      const page1 = await convert(1, { responseType: "base64" });
      if (!page1 || !page1.base64) {
        throw new Error("PDF 转换图片失败");
      }
      imageBase64 = page1.base64;
    } else {
      imageBase64 = fileBuffer.toString('base64');
    }
  } catch (err: any) {
    console.error("📄 PDF处理异常:", err);
    return { success: false, error: "发票文件解析失败 (PDF处理异常)" };
  }

  // 直接走视觉大模型解析
  return callQwenVLParse(imageBase64);
}

// async function callSmartDocumentParse... (已废弃)
// function detectInvoiceType... (已废弃)
