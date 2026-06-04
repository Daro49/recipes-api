require('dotenv').config();

const express = require('express');
const cors = require('cors');


const app = express();
app.use(cors());
app.use(express.json());


app.get('/', (req, res) => {
    console.log('Loaded');
    res.send('Hello there');
})

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port: ${PORT}`));
