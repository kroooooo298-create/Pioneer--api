const express = require('express');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.json());

// 這是接收 TradingView 訊號的入口
app.post('/webhook', (req, res) => {
    const data = req.body;
    console.log("阿發測試機器人收到新訊號！內容：", data);
    res.status(200).send("Signal Received");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`API 機器人大腦正在運行，端口：${PORT}`);
});
