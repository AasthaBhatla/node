require("dotenv").config();
const express = require("express");
const app = express();

app.use(express.json());

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const requestRoutes = require("./routes/requestRoutes");
const taxonomyRoutes = require("./routes/taxonomy"); 
const termsRoutes = require("./routes/termsRoutes");
const partnerRoutes = require('./routes/partnerRoutes');
const productRoutes = require("./routes/productRoutes");
const orderItemRoutes = require("./routes/orderItemRoutes");
const bannerRoutes = require("./routes/bannerRoutes");
const locationRoutes = require("./routes/locationRoutes");   
const languageRoutes = require("./routes/languageRoutes"); 

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/requests", requestRoutes);
app.use("/taxonomies", taxonomyRoutes); 
app.use("/terms", termsRoutes);
app.use('/partners', partnerRoutes);
app.use("/products", productRoutes);
app.use("/order-items", orderItemRoutes);
app.use("/banners", bannerRoutes);
app.use("/locations", locationRoutes);  
app.use("/languages", languageRoutes);

app.get("/", (req, res) => {
  res.json({ message: "API is working!" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`);
});
