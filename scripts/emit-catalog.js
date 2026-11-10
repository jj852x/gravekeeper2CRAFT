const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const data = fs.readFileSync(path.join(root, "data", "catalog.json"), "utf8");
const body = "(function () {\nwindow.GK2Catalog = " + data.trim() + ";\n})();\n";
fs.writeFileSync(path.join(root, "catalog.js"), body);
console.log("wrote", body.length);
