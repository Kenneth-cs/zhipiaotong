CREATE DATABASE IF NOT EXISTS smart_invoice DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_invoice;

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(20) PRIMARY KEY COMMENT '用户ID，如U100001',
  phone VARCHAR(20) UNIQUE NOT NULL COMMENT '手机号',
  password_hash VARCHAR(255) NOT NULL COMMENT '加密密码',
  nickname VARCHAR(50) DEFAULT NULL COMMENT '昵称',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- 用户ID自增序列辅助表
CREATE TABLE IF NOT EXISTS user_id_seq (
  id INT AUTO_INCREMENT PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 发票记录表
CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL COMMENT '关联用户',
  invoice_code VARCHAR(50) DEFAULT NULL COMMENT '发票代码',
  invoice_number VARCHAR(50) DEFAULT NULL COMMENT '发票号码',
  invoice_date VARCHAR(30) DEFAULT NULL COMMENT '开票日期',
  amount DECIMAL(12,2) DEFAULT 0.00 COMMENT '金额（不含税）',
  tax DECIMAL(12,2) DEFAULT 0.00 COMMENT '税额',
  total DECIMAL(12,2) DEFAULT 0.00 COMMENT '价税合计',
  seller_name VARCHAR(255) DEFAULT NULL COMMENT '销售方名称',
  buyer_name VARCHAR(255) DEFAULT NULL COMMENT '购买方名称',
  tax_id VARCHAR(50) DEFAULT NULL COMMENT '销售方纳税人识别号',
  file_name VARCHAR(255) NOT NULL COMMENT '原始文件名',
  status ENUM('normal','duplicate') DEFAULT 'normal' COMMENT '状态',
  raw_ocr_json TEXT DEFAULT NULL COMMENT 'OCR原始返回JSON',
  batch_id VARCHAR(50) DEFAULT NULL COMMENT '批次ID',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX idx_user (user_id),
  INDEX idx_invoice_number (invoice_code, invoice_number),
  INDEX idx_batch (batch_id),
  INDEX idx_status (status),
  INDEX idx_date (invoice_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='发票记录';

SHOW TABLES;