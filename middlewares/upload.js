const multer = require('multer');
const path = require('path');
const fs = require('fs');

function getUploadConfig(type = 'profile') {
  let folder = '';
  let allowedTypes = [];

  if (type === 'profile') {
    folder = 'uploads/profile-pictures';
    allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
  } else if (type === 'document') {
    folder = 'uploads/documents';
    allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'image/jpeg',
      'image/png',
    ];
  } else {
    throw new Error('Invalid upload type');
  }

  const uploadDir = path.join(__dirname, '..', folder);
  fs.mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const uniqueName = `${req.user.id}_${Date.now()}${ext}`;
      cb(null, uniqueName);
    },
  });

  const fileFilter = (req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'));
  };

  return multer({ storage, fileFilter });
}

module.exports = getUploadConfig;

