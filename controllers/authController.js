const jwt = require("jsonwebtoken");
const {
  normalizePhone,
  getUserByEmailOrPhone,
  insertUser,
  setOtp,
  verifyOtp,
  clearOtp,
  updateUserMetadata,
  getUserMetadata,
  markUserAsRegistered,
  updateUserRole,
  saveDeviceToken,
  removeDeviceToken,
  getUserById,
  updateUser,
} = require("../services/userService");

exports.login = async (req, res) => {
  const { email, phone: raw_phone, device_token } = req.body;
  const phone = normalizePhone(raw_phone);

  if (!email && !phone) {
    return res.status(400).json({ error: "Provide email or phone" });
  }

  if (!device_token) {
    return res.status(400).json({ error: "Device token is required" });
  }

  try {
    let user = await getUserByEmailOrPhone(email, phone);
    if (!user) user = await insertUser(email, phone);

    await saveDeviceToken(user.id, device_token);

    const otp = await setOtp(user.id);
    console.log(`OTP sent to ${email || phone}: ${otp}`);

    res.json({ message: "OTP sent", status: user.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.verifyOtp = async (req, res) => {
  const { email, phone: raw_phone, otp } = req.body;
  const phone = normalizePhone(raw_phone);

  if (!otp || (!email && !phone)) {
    return res.status(400).json({ error: "OTP and email/phone required" });
  }

  try {
    const user = await getUserByEmailOrPhone(email, phone);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.status === "blocked")
      return res.status(403).json({ error: "User is blocked" });

    // ✅ Simple bypass: allow OTP "123456"
    if (otp.toString() === "123456") {
      isValid = true;
    } else {
      isValid = await verifyOtp(user.id, otp.toString());
    }

    if (!isValid) return res.status(401).json({ error: "Invalid OTP" });

    await clearOtp(user.id);

    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET || "defaultsecret",
      {
        expiresIn: "1h",
      }
    );

    res.json({
      message: "OTP verified",
      token,
      user_id: user.id,
      status: user.status,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.register = async (req, res) => {
  const {
    role,
    status,
    email,
    phone: raw_phone,
    ...rest
  } = req.body;

  const phone = normalizePhone(raw_phone);

  try {
    const user = req.user;
    if (!user) {
      return res.status(403).json({ error: "User not found" });
    }

    const existingUser = await getUserById(user.id);

    if (!existingUser.email && email) {
      const emailCheck = await getUserByEmailOrPhone(email, null);
      if (emailCheck && emailCheck.id !== user.id) {
        return res.status(409).json({ error: "Email already in use" });
      }
    }

    if (!existingUser.phone && phone) {
      const phoneCheck = await getUserByEmailOrPhone(null, phone);
      if (phoneCheck && phoneCheck.id !== user.id) {
        return res.status(409).json({ error: "Phone number already in use" });
      }
    }

    const userUpdateFields = {};
    if (!existingUser.email && email) userUpdateFields.email = email;
    if (!existingUser.phone && phone) userUpdateFields.phone = phone;
    if (role) userUpdateFields.role = role.toLowerCase();
    if (status) userUpdateFields.status = status;

    if (Object.keys(userUpdateFields).length > 0) {
      await updateUser(user.id, userUpdateFields);
    }

    if (Object.keys(rest).length > 0) {
      await updateUserMetadata(user.id, rest);
    }

    await markUserAsRegistered(user.id);

    return res.status(200).json({ message: "Registration completed successfully" });
  } catch (err) {
    console.error("Registration error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.logout = async (req, res) => {
  const { device_token } = req.body;

  if (!device_token) {
    return res.status(400).json({ error: "Device token is required" });
  }

  try {
    const user_id = req.user.id;
    const deleted = await removeDeviceToken(user_id, device_token);

    if (deleted === 0) {
      return res.status(404).json({ error: "Device token not found" });
    }

    return res.json({ message: "Logout successful" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.resendOtp = async (req, res) => {
  const { email, phone: raw_phone, device_token } = req.body;
  const phone = normalizePhone(raw_phone);

  if (!email && !phone) {
    return res.status(400).json({ error: "Provide email or phone" });
  }

  try {
    let user = await getUserByEmailOrPhone(email, phone);
    if (!user) {
      user = await insertUser(email, phone);
    }

    const otp = await setOtp(user.id);
    console.log(`OTP resent to ${email || phone}: ${otp}`);

    res.json({
      message: "OTP resent successfully",
    });
  } catch (err) {
    console.error("Resend OTP Error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
exports.createUserWithProfile = async (req, res) => {
  try {
  //  if (req.user.role !== "admin")
  //    return res.status(403).json({ error: "Only admin can create user profile" });

    const {
      email,
      phone: raw_phone,
      role,
      status,
      ...metadata 
    } = req.body;

    if (!email && !raw_phone) {
      return res.status(400).json({ error: "Email or phone is required" });
    }
    if (!role) {
      return res.status(400).json({ error: "Role is required" });
    }

    const phone = normalizePhone(raw_phone);

    let user = await getUserByEmailOrPhone(email, phone);
    if (user) {
      return res.status(409).json({ error: "User already exists" });
    }

    user = await insertUser(email, phone);

    const userUpdateFields = {};
    if (role) userUpdateFields.role = role.toLowerCase();
    if (status) userUpdateFields.status = status;
    if (Object.keys(userUpdateFields).length > 0) {
      await updateUser(user.id, userUpdateFields);
    }

    await markUserAsRegistered(user.id);

    if (Object.keys(metadata).length > 0) {
      await updateUserMetadata(user.id, metadata);
    }

    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET || "defaultsecret",
      { expiresIn: "1h" }
    );

    res.status(201).json({
      message: "User created successfully",
      user_id: user.id,
      token,
      status: "registered",
    });
  } catch (err) {
    console.error("Create user error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
