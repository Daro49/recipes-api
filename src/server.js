require('dotenv').config();

const express = require('express');
const cors = require('cors');

const kitchenwareRouter = require('./routes/kitchenware');
const recipesRouter = require('./routes/recipes');


const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/kitchenware', kitchenwareRouter);
app.use('/recipes', recipesRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port: ${PORT}`));
