const db = require('../db'); 
const fs = require('fs');
const path = require('path');
const { 
  getUserById,
  getUserMetadata,
  updateUserMetadata,
  updateUserRole,
  updateProfilePicUrl,
  addDocumentToMetadata,
  removeDocumentFromMetadata,
  getUserDocuments,
  getUsers
} = require('../services/userService'); // or correct path


exports.getMe = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await getUserById(userId); 
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const metadata = await getUserMetadata(userId); 
    res.json({ ...user, metadata });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
exports.updateMe = async (req, res) => {
  const userId = req.user.id;
  const {
    firstName,
    middleName,
    lastName,
    dob,
    gender,
    role
  } = req.body;

  const allowedGenders = ['male', 'female', 'other'];
  const allowedRoles = ['client', 'lawyer', 'expert', 'ngo'];

  if (gender && !allowedGenders.includes(gender.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid gender' });
  }

  if (role && !allowedRoles.includes(role.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await updateUserMetadata(userId, {
      ...(firstName && { first_name: firstName }),
      ...(middleName && { middle_name: middleName }),
      ...(lastName && { last_name: lastName }),
      ...(dob && { dob }),
      ...(gender && { gender: gender.toLowerCase() })
    });

    if (role) {
      await updateUserRole(userId, role.toLowerCase());
    }

    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Update user profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
exports.getUsers = async (req, res) => {
  try {
    const {
      role,
      status,
      count,
      page,
      orderBy,
      order,
      email,
      phone,
      search,
      withMetadata
    } = req.query;

    const metaQuery = req.query.metaQuery
      ? JSON.parse(req.query.metaQuery)
      : undefined;

    const filters = {
      role,
      status,
      count: parseInt(count) || 10,
      page: parseInt(page) || 1,
      orderBy,
      order,
      email,
      phone,
      search,
      withMetadata: withMetadata === 'true',
      metaQuery,
    };

    const users = await getUsers(filters);
    res.status(200).json({ users });
  } catch (err) {
    console.error('Error in getUsers controller:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};
exports.getUserById = async (req, res) => {
  const userId = req.params.id;

  try {
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const metadata = await getUserMetadata(userId); 
    res.json({ ...user, metadata });
  } catch (err) {
    console.error('Get user by ID error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
exports.updateUserMetaByAdmin = async (req, res) => {
  const requestingUser = req.user;
  const targetUserId = req.params.id;
  const { firstName, middleName, lastName, dob, gender, role } = req.body;

  const allowedGenders = ['male', 'female', 'other'];
  const allowedRoles = ['client', 'lawyer', 'expert', 'ngo', 'admin'];

  if (gender && !allowedGenders.includes(gender.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid gender' });
  }

  if (role && !allowedRoles.includes(role.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    if (requestingUser.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can update other users\' metadata' });
    }

    const user = await getUserById(targetUserId);
    if (!user) return res.status(404).json({ error: 'Target user not found' });

    await updateUserMetadata(targetUserId, {
      ...(firstName && { first_name: firstName }),
      ...(middleName && { middle_name: middleName }),
      ...(lastName && { last_name: lastName }),
      ...(dob && { dob }),
      ...(gender && { gender: gender.toLowerCase() }),
    });

    if (role) {
      await updateUserRole(targetUserId, role.toLowerCase());
    }

    res.json({ message: 'User metadata updated by admin successfully' });
  } catch (err) {
    console.error('Update user meta by admin error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
exports.uploadProfilePic = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ error: 'Profile picture file is required' });
    }

    const profilePicUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    await updateProfilePicUrl(userId, profilePicUrl);

    res.status(200).json({ message: 'Profile picture updated successfully', url: profilePicUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile picture' });
  }
};
exports.uploadDocument = async (req, res) => {
  const userRole = req.user.role;
  const allowedRoles = ['admin', 'lawyer', 'expert'];

  if (!allowedRoles.includes(userRole)) {
    return res.status(403).json({ error: 'Access denied. Only admin, lawyer, and expert can upload documents.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = path.join('uploads', 'documents', req.file.filename);
  const originalName = req.file.originalname;

  try {
    await addDocumentToMetadata(req.user.id, {
      path: filePath,
      name: originalName,
      uploadedAt: new Date().toISOString()
    });

    return res.status(200).json({
      message: 'Document uploaded successfully',
      filePath
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to upload document' });
  }
};
exports.deleteDocument = async (req, res) => {
  const userId = req.user.id;
  const name = req.params.name;

  try {
    const metadata = await getUserMetadata(userId);
    console.log("Fetched metadata:", metadata);

    let documents = [];

    try {
      const outerParsed = JSON.parse(metadata.documents);

      documents = typeof outerParsed.documents === 'string'
        ? JSON.parse(outerParsed.documents)
        : outerParsed.documents;

    } catch (err) {
      console.error("Failed to parse documents JSON:", err);
      return res.status(500).json({ error: 'Invalid document metadata format' });
    }

    const docToDelete = documents.find(doc => doc.name === name);
    if (!docToDelete) {
      return res.status(404).json({ error: 'Document not found' });
    }

    await removeDocumentFromMetadata(userId, name);

    const fullPath = path.join(__dirname, '..', '..', docToDelete.path);
    console.log("Deleting file at:", fullPath);

    try {
      await fs.promises.unlink(fullPath);
    } catch (err) {
      console.warn('Failed to delete file from disk:', err.message);
    }

    return res.status(200).json({ message: 'Document deleted successfully' });

  } catch (err) {
    console.error('Delete document error:', err);
    return res.status(500).json({ error: 'Failed to delete document' });
  }
};
exports.listUserDocuments = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const allowedRoles = ['admin', 'lawyer', 'expert'];
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const documents = await getUserDocuments(userId);
    return res.status(200).json({ documents });

  } catch (err) {
    console.error('Error listing documents:', err);
    return res.status(500).json({ error: 'Failed to list documents' });
  }
};

