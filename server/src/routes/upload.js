import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { requireAuth } from '../middleware/auth.js';
import { uploadBuffer } from '../services/firebaseStorage.service.js';

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /^image\/(jpeg|jpg|png|gif|webp)$|^video\/(mp4|mov|avi|webm)$/i;
    if (allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'), false);
  },
});

const router = Router();
router.use(requireAuth);

router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = path.extname(req.file.originalname) || '.jpg';
    const safe = Buffer.from(String(Date.now()) + Math.random().toString(36)).toString('base64url').slice(0, 12);
    const filename = `post-${safe}${ext}`;

    const result = await uploadBuffer(req.file.buffer, filename, req.file.mimetype);
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
    res.json({ url: result.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
