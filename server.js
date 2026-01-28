require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();

console.log("RAZORPAY_KEY_ID exists?", !!process.env.RAZORPAY_KEY_ID);
console.log(
  "RAZORPAY_WEBHOOK_SECRET exists?",
  !!process.env.RAZORPAY_WEBHOOK_SECRET,
);

// app.set("trust proxy", 3);

const webhookRoutes = require("./routes/webhookRoutes");

app.use(cors());

app.use(
  "/webhooks/razorpay",
  express.raw({ type: "application/json" }),
  webhookRoutes,
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const requestRoutes = require("./routes/requestRoutes");
const taxonomyRoutes = require("./routes/taxonomy");
const termsRoutes = require("./routes/termsRoutes");
//const partnerRoutes = require('./routes/partnerRoutes');
const productRoutes = require("./routes/productRoutes");
const orderItemRoutes = require("./routes/orderItemRoutes");
//const bannerRoutes = require("./routes/bannerRoutes");
const locationRoutes = require("./routes/locationRoutes");
const languageRoutes = require("./routes/languageRoutes");
const postRoutes = require("./routes/postRoutes");
const optionsRoutes = require("./routes/optionsRoutes");
const orderRoutes = require("./routes/orderRoutes");
const reviewsRoutes = require("./routes/reviewsRoutes");
const relationshipRoutes = require("./routes/relationshipRoutes");
const s3Routes = require("./routes/s3Routes");
const walletRoutes = require("./routes/walletRoutes");
const workspaceRoutes = require("./routes/workspaceRoutes");
const sessionRoutes = require("./routes/sessionRoutes");
const adminNotifications = require("./routes/adminNotifications");

app.use("/sessions", sessionRoutes);
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/requests", requestRoutes);
app.use("/taxonomies", taxonomyRoutes);
app.use("/terms", termsRoutes);
//app.use('/partners', partnerRoutes);
app.use("/products", productRoutes);
app.use("/order-items", orderItemRoutes);
//app.use("/banners", bannerRoutes);
app.use("/locations", locationRoutes);
app.use("/languages", languageRoutes);
app.use("/posts", postRoutes);
app.use("/options", optionsRoutes);
app.use("/orders", orderRoutes);
app.use("/reviews", reviewsRoutes);
app.use("/relationships", relationshipRoutes);
app.use("/uploadnow", s3Routes);
app.use("/wallet", walletRoutes);
app.use("/workspace", workspaceRoutes);
app.use("/admin/notifications", adminNotifications);

app.get("/", (req, res) => {
  res.json({ message: "API is working!" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`);
});
