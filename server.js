require("dotenv").config();
const express = require("express");
const app = express();

app.use(express.json());

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const requestRoutes = require("./routes/requestRoutes");
const taxonomyRoutes = require("./routes/taxonomy"); 
const termsRoutes = require("./routes/termsRoutes");

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/requests", requestRoutes);
app.use("/taxonomies", taxonomyRoutes); 
app.use("/terms", termsRoutes);

app.get("/", (req, res) => {
  res.json({ message: "API is working!" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`);
});
