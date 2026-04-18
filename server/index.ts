import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pool from './db';
import authRouter from './routes/auth';
import ocrRouter from './routes/ocr';
import invoicesRouter from './routes/invoices';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.SERVER_PORT || '3001');

// 中间件
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 路由
app.use('/api/auth', authRouter);
app.use('/api/ocr', ocrRouter);
app.use('/api/invoices', invoicesRouter);

// 健康检查
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

// 全局错误处理
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('❌ 服务器错误:', err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: '文件大小超过 10MB 限制' });
  }
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`🚀 智票通后端服务已启动: http://localhost:${PORT}`);
  console.log(`📋 健康检查: http://localhost:${PORT}/api/health`);
});