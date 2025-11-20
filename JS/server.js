const express = require('express');
const Razorpay = require('razorpay');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

app.use(cors());
// Increase the limit to handle base64 images
app.use(express.json({ limit: '50mb' }));

const usersFilePath = path.join(__dirname, '..', 'users.json');

// Function to read users from the JSON file
const readUsers = () => {
    if (!fs.existsSync(usersFilePath)) {
        console.log('users.json not found, returning empty array.');
        return [];
    }
    const usersData = fs.readFileSync(usersFilePath);
    // Handle empty file case
    if (usersData.length === 0) {
        console.log('users.json is empty, returning empty array.');
        return [];
    }
    return JSON.parse(usersData);
};

// Function to write users to the JSON file
const writeUsers = (users) => {
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
};

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

// Endpoint to get all users
app.get('/api/users', (req, res) => {
    console.log('\n--- Received GET request for /api/users ---');
    try {
        const users = readUsers();
        console.log(`Sending ${users.length} users to the admin panel.`);
        res.json(users);
    } catch (error) {
        console.error('Error reading user data:', error);
        res.status(500).send({ message: "Error reading user data.", error });
    }
});

// Endpoint to create or update a user profile
app.post('/api/users', (req, res) => {
    console.log('\n--- Received POST request for /api/users ---');
    try {
        const users = readUsers();
        const updatedUser = req.body;
        console.log('Received user data:', JSON.stringify(updatedUser, null, 2));


        // Use email as the unique identifier
        const userIndex = users.findIndex(u => u.email === updatedUser.email);

        if (userIndex !== -1) {
            console.log(`User found at index ${userIndex}. Updating existing user.`);
            // Update existing user
            users[userIndex] = { ...users[userIndex], ...updatedUser };
        } else {
            console.log('User not found. Creating a new user.');
            // Add new user
            const newId = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
            const newUser = { 
                id: newId, 
                ...updatedUser,
                createdAt: new Date().toISOString()
            };
            users.push(newUser);
        }
        
        console.log('Attempting to write updated users list to users.json...');
        writeUsers(users);
        console.log('Successfully wrote to users.json.');

        res.status(200).json({ message: 'User profile saved successfully!' });
    } catch (error) {
        console.error('---!!! ERROR saving user profile !!!---:', error);
        res.status(500).send({ message: "Error saving user profile.", error });
    }
});


app.listen(port, () => {
  console.log(`Supercart server listening at http://localhost:${port}`);
});
