import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db';
import { generateToken, authMiddleware, AuthRequest } from '../middleware/auth';
import { ResultSetHeader, RowDataPacket } from 'mysql2';

const router = Router();

// 生成用户ID: U100001, U100002, ...
async function generateUserId(): Promise<string> {
  const [result] = await pool.query<ResultSetHeader>('INSERT INTO user_id_seq VALUES ()');
  const seq = result.insertId;
  return `U${String(seq + 100000).padStart(6, '0')}`;
}

// 注册
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { phone, password, nickname } = req.body;

    // 参数校验
    if (!phone || !password) {
      return res.status(400).json({ error: '手机号和密码不能为空' });
    }

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ error: '手机号格式不正确' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '密码长度至少 6 位' });
    }

    // 检查手机号是否已注册
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE phone = ?',
      [phone]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: '该手机号已注册' });
    }

    // 生成用户ID和加密密码
    const userId = await generateUserId();
    const passwordHash = await bcrypt.hash(password, 10);

    // 插入用户
    await pool.query(
      'INSERT INTO users (id, phone, password_hash, nickname) VALUES (?, ?, ?, ?)',
      [userId, phone, passwordHash, nickname || `用户${phone.slice(-4)}`]
    );

    // 生成 JWT
    const token = generateToken(userId);

    res.status(201).json({
      message: '注册成功',
      data: {
        userId,
        phone,
        nickname: nickname || `用户${phone.slice(-4)}`,
        token,
      },
    });
  } catch (err: any) {
    console.error('注册失败:', err);
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

// 登录
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ error: '手机号和密码不能为空' });
    }

    // 查找用户
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, phone, password_hash, nickname, created_at FROM users WHERE phone = ?',
      [phone]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: '手机号或密码错误' });
    }

    const user = rows[0];

    // 验证密码
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: '手机号或密码错误' });
    }

    // 生成 JWT
    const token = generateToken(user.id);

    res.json({
      message: '登录成功',
      data: {
        userId: user.id,
        phone: user.phone,
        nickname: user.nickname,
        token,
      },
    });
  } catch (err: any) {
    console.error('登录失败:', err);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

// 获取当前用户信息
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, phone, nickname, created_at FROM users WHERE id = ?',
      [req.userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({ data: rows[0] });
  } catch (err: any) {
    console.error('获取用户信息失败:', err);
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

export default router;