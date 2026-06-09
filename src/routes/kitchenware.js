const express = require('express');
const router = express.Router();
const db = require('../database');

// GET all kitcherware from database
router.get('/', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM kitchenware');
        res.json(rows);
    }
    catch(err) {
        console.error('Database Query Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;