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
  getUsers,
  updateUserLanguage,
  addUserTerms,
  removeUserTerms
} = require('../services/userService');


exports.getMe = async (req, res) => {
  const user_id = req.user.id;

  try {
    const user = await getUserById(user_id); 
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const metadata = await getUserMetadata(user_id); 
    res.json({ ...user, metadata });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateMe = async (req, res) => {
  const user_id = req.user.id;
  const { gender, language_id, add_terms, remove_terms, ...otherMetadata } = req.body;

  const allowed_genders = ['male', 'female', 'other'];

  if (gender && !allowed_genders.includes(gender.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid gender' });
  }

  if (language_id && typeof language_id !== 'number') {
    return res.status(400).json({ error: 'language_id must be a number' });
  }

  if (add_terms && !Array.isArray(add_terms)) {
    return res.status(400).json({ error: 'add_terms must be an array of term IDs' });
  }

  if (remove_terms && !Array.isArray(remove_terms)) {
    return res.status(400).json({ error: 'remove_terms must be an array of term IDs' });
  }

  try {
    const user = await getUserById(user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const metadataUpdates = {
      ...otherMetadata,
      ...(gender && { gender: gender.toLowerCase() })
    };
    if (Object.keys(metadataUpdates).length > 0) {
      await updateUserMetadata(user_id, metadataUpdates);
    }

    if (language_id) {
      await updateUserLanguage(user_id, language_id);
    }

    if (add_terms?.length) {
      await addUserTerms(user_id, add_terms);
    }
    if (remove_terms?.length) {
      await removeUserTerms(user_id, remove_terms);
    }

    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Update user error:', err);
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
      order_by,
      order,
      email,
      phone,
      search,
      metaQuery
    } = req.body;

    const filters = {
      role,
      status,
      count: parseInt(count) || 10,
      page: parseInt(page) || 1,
      order_by,
      order,
      email,
      phone,
      search,
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
  const user_id = req.params.id;

  try {
    const user = await getUserById(user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const metadata = await getUserMetadata(user_id); 
    res.json({ ...user, metadata });
  } catch (err) {
    console.error('Get user by ID error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateUserMetaByAdmin = async (req, res) => {
  const requesting_user = req.user;
  const target_user_id = req.params.id;
  const {
    first_name,
    middle_name,
    last_name,
    dob,
    gender,
    role,
    language_id,
    add_terms,
    remove_terms,
    email,
    phone,
    status
  } = req.body;

  const allowed_genders = ['male', 'female', 'other'];
  const allowed_statuses = ['new', 'registered', 'verified', 'blocked']; 

  if (gender && !allowed_genders.includes(gender.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid gender' });
  }

  if (language_id && typeof language_id !== 'number') {
    return res.status(400).json({ error: 'language_id must be a number' });
  }

  if (add_terms && !Array.isArray(add_terms)) {
    return res.status(400).json({ error: 'add_terms must be an array of term IDs' });
  }

  if (remove_terms && !Array.isArray(remove_terms)) {
    return res.status(400).json({ error: 'remove_terms must be an array of term IDs' });
  }

  if (status && !allowed_statuses.includes(status.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    if (requesting_user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can update other users\' metadata' });
    }

    const user = await getUserById(target_user_id);
    if (!user) return res.status(404).json({ error: 'Target user not found' });

    await updateUserMetadata(target_user_id, {
      ...(first_name && { first_name }),
      ...(middle_name && { middle_name }),
      ...(last_name && { last_name }),
      ...(dob && { dob }),
      ...(gender && { gender: gender.toLowerCase() })
    });

    if (role) {
      await updateUserRole(target_user_id, role.toLowerCase());
    }

    if (language_id) {
      await updateUserLanguage(target_user_id, language_id);
    }

    if (email || phone || status) {
      await updateUser(target_user_id, {
        ...(email && { email }),
        ...(phone && { phone }),
        ...(status && { status: status.toLowerCase() })
      });
    }

    if (add_terms?.length) {
      await addUserTerms(target_user_id, add_terms);
    }
    if (remove_terms?.length) {
      await removeUserTerms(target_user_id, remove_terms);
    }

    res.json({ message: 'User updated by admin successfully' });
  } catch (err) {
    console.error('Update user meta by admin error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.uploadProfilePic = async (req, res) => {
  try {
    const user_id = req.user.id;

    if (!req.file) {
      return res.status(400).json({ error: 'Profile picture file is required' });
    }

    const profile_pic_url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    await updateProfilePicUrl(user_id, profile_pic_url);

    res.status(200).json({ message: 'Profile picture updated successfully', url: profile_pic_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile picture' });
  }
};

exports.uploadDocument = async (req, res) => {
  const user_role = req.user.role;
  const allowed_roles = ['admin', 'lawyer', 'expert'];

  if (!allowed_roles.includes(user_role)) {
    return res.status(403).json({ error: 'Access denied. Only admin, lawyer, and expert can upload documents.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const file_path = path.join('uploads', 'documents', req.file.filename);
  const original_name = req.file.originalname;

  try {
    await addDocumentToMetadata(req.user.id, {
      path: file_path,
      name: original_name,
      uploaded_at: new Date().toISOString()
    });

    return res.status(200).json({
      message: 'Document uploaded successfully',
      file_path
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to upload document' });
  }
};

exports.deleteDocument = async (req, res) => {
  const user_id = req.user.id;
  const name = req.params.name;

  try {
    const metadata = await getUserMetadata(user_id);
    console.log("Fetched metadata:", metadata);

    let documents = [];

    try {
      const outer_parsed = JSON.parse(metadata.documents);

      documents = typeof outer_parsed.documents === 'string'
        ? JSON.parse(outer_parsed.documents)
        : outer_parsed.documents;

    } catch (err) {
      console.error("Failed to parse documents JSON:", err);
      return res.status(500).json({ error: 'Invalid document metadata format' });
    }

    const doc_to_delete = documents.find(doc => doc.name === name);
    if (!doc_to_delete) {
      return res.status(404).json({ error: 'Document not found' });
    }

    await removeDocumentFromMetadata(user_id, name);

    const full_path = path.join(__dirname, '..', '..', doc_to_delete.path);
    console.log("Deleting file at:", full_path);

    try {
      await fs.promises.unlink(full_path);
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
  const user_id = req.user.id;

  try {
    const user = await getUserById(user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const allowed_roles = ['admin', 'lawyer', 'expert'];
    if (!allowed_roles.includes(user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const documents = await getUserDocuments(user_id);
    return res.status(200).json({ documents });

  } catch (err) {
    console.error('Error listing documents:', err);
    return res.status(500).json({ error: 'Failed to list documents' });
  }
};
