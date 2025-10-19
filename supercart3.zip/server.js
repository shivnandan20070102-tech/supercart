const express = require('express');
const Razorpay = require('razorpay');
const cors = require('cors');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Replace with your Razorpay Key ID and Key Secret
const razorpay = new Razorpay({
  key_id: 'YOUR_KEY_ID',
  key_secret: 'YOUR_KEY_SECRET',
});

app.post('/create-order', async (req, res) => {
  const { amount, currency, receipt } = req.body;

  const options = {
    amount: amount * 100, // amount in the smallest currency unit
    currency,
    receipt,
  };

  try {
    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (error) {
    res.status(500).send(error);
  }
});

app.listen(port, () => {
  console.log(`Supercart server listening at http://localhost:${port}`);
});
