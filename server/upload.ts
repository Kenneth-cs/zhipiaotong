import multer from 'multer';

// 文件上传配置（内存存储，不落盘）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 100,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式，仅支持 JPG、PNG、PDF'));
    }
  },
});

export default upload;