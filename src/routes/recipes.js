const express = require('express');
const router = express.Router();
const db = require('../database');

// Fetch kitchenware and alternatives for one recipe
async function attachRelations(recipe) {
    const kw = await db.query(
        `SELECT k.id, k.name
        FROM kitchenware k
        JOIN recipe_kitchenware rk ON rk.kitchenware_id = k.id
        WHERE rk.recipe_id = $1`,
        [recipe.id]
    );

    const alts = await db.query(
        `SELECT r.id, r.name, r.effort, r.prep_time, r.cook_time, r.photo_url
        FROM recipe r
        JOIN recipe_alternatives ra
        ON (ra.recipe_id_a = r.id OR ra.recipe_id_b = r.id)
        WHERE (ra.recipe_id_a = $1 OR ra.recipe_id_b = $1)
        AND r.id <> $1`,
        [recipe.id]
    );

    return {
        ...recipe,
        kitchenware: kw.rows,
        alternatives: alts.rows,
    };
}

// Canonical pair ordering required by the CHECK constraint in DB
function altPair(a, b) {
    return a < b ? [a, b] : [b, a];
}


// ── GET /api/recipes ───────────────────────────────────────
// Get all recipes
// Optional filters: ?effort=<effort> ?kitchenware_id=<id>
router.get('/', async (req, res) => {
    try {
        const conditions = [];
        const values = [];

        if (req.query.effort) {
            values.push(req.query.effort);
            conditions.push(`r.effort = $${values.length}`);
        }

        if (req.query.kitchenware_id) {
            // Input into an array (handles both single strings and arrays)
            const kitchenwares = [].concat(req.query.kitchenware_id);

            // Loop through each kitchenware and add a separate EXISTS condition
            for (const kwId of kitchenwares) {
                values.push(kwId);
                conditions.push(`EXISTS (
                    SELECT 1 FROM recipe_kitchenware rk
                    WHERE rk.recipe_id = r.id AND rk.kitchenware_id = $${values.length}
                )`);
            }
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const { rows } = await db.query(
            `SELECT * FROM recipe r ${where}`,
            values
        );
        res.json(rows);
    }
    catch(err) {
        console.error('Database Query Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// ── GET /api/recipes/:id ───────────────────────────────────
// Get particular recipe
router.get('/:id', async (req, res) => {
    try {
        const { rows } = await db.query(
            'SELECT * FROM recipe WHERE id = $1',
            [req.params.id]
        );

        if (!rows.length) return res.status(404).json({ error: 'Recipe not found' });
        
        res.json(await attachRelations(rows[0]));
    }
    catch(err) {
        console.error('Database Query Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// ── POST /api/recipes ──────────────────────────────────────
router.post('/', async (req, res) => {
    const {
        name, effort, prep_time, cook_time,
        ingredients, directions, photo_url, kitchenware_ids
    } = req.body;

    if (!name || !effort || cook_time == null)
        return res.status(400).json({ error: 'name, effort, and cook_time are required' });

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `INSERT INTO recipe
                (name, effort, prep_time, cook_time, ingredients, directions, photo_url)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING *`,
            [name, effort, prep_time ?? null, cook_time,
            ingredients ?? [], directions ?? [], photo_url ?? null]
        );
        const recipe = rows[0];

        if (kitchenware_ids?.length) {
            for (const kwId of kitchenware_ids) {
                await client.query(
                    'INSERT INTO recipe_kitchenware (recipe_id, kitchenware_id) VALUES ($1, $2)',
                    [recipe.id, kwId]
                );
            }
        }

        await client.query('COMMIT');
        res.status(201).json(await attachRelations(recipe));
    }

    catch (err) {
        await client.query('ROLLBACK');
        console.error('Database Query Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }

    finally {
        client.release();
    }
});


// ── PUT /api/recipes/:id ───────────────────────────────────
// Update/edit particular recipe
router.put('/:id', async (req, res) => {
    const {
        name, effort, prep_time, cook_time,
        ingredients, directions, photo_url, kitchenware_ids
    } = req.body;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `UPDATE recipe SET
                name            = COALESCE($1, name),
                effort          = COALESCE($2, effort),
                prep_time   = COALESCE($3, prep_time),
                cook_time   = COALESCE($4, cook_time),
                ingredients     = COALESCE($5, ingredients),
                directions      = COALESCE($6, directions),
                photo_url       = COALESCE($7, photo_url),
            WHERE id = $8
            RETURNING *`,
            [name, effort, prep_time, cook_time,
            ingredients, directions, photo_url, req.params.id]
        );

        if (!rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Recipe not found' });
        }

        // Replace kitchenware if provided
        if (kitchenware_ids?.length) {
            await client.query(
                'DELETE FROM recipe_kitchenware WHERE recipe_id = $1',
                [req.params.id]
        );
        for (const kwId of kitchenware_ids) {
            await client.query(
                'INSERT INTO recipe_kitchenware (recipe_id, kitchenware_id) VALUES ($1, $2)',
                [req.params.id, kwId]
            );
        }
        }

        await client.query('COMMIT');
        res.json(await attachRelations(rows[0]));
    }

    catch (err) {
        await client.query('ROLLBACK');
        console.error('Database Query Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
    
    finally {
        client.release();
    }
});


// ── DELETE /api/recipes/:id ────────────────────────────────
// Delete particular recipe
router.delete('/:id', async (req, res) => {
    try {
        const { rows } = await db.query(
            'DELETE FROM recipe WHERE id = $1',
            [req.params.id]
        );

        if (!rows.length) return res.status(404).json({ error: 'Recipe not found' });
        res.status(204).send();

    }
    catch (err) {
        console.error('Database Query Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// ── POST /api/recipes/:id/alternatives ────────────────────
router.post('/:id/alternatives', async (req, res) => {
    const { alternative_id } = req.body;
    
    if (!alternative_id)
        return res.status(400).json({ error: 'alternative_id is required' });

    const [a, b] = altPair(req.params.id, alternative_id);
    try {
        await db.query(
            `INSERT INTO recipe_alternatives (recipe_id_a, recipe_id_b)
            VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [a, b]
        );

        res.status(201).json({ recipe_id_a: a, recipe_id_b: b });
    }
    catch (err) {
        console.error('Database Query Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// ── DELETE /api/recipes/:id/alternatives/:altId ────────────
router.delete('/:id/alternatives/:altId', async (req, res) => {
    const [a, b] = altPair(req.params.id, req.params.altId);

    try {
        const { row } = await db.query(
            'DELETE FROM recipe_alternatives WHERE recipe_id_a = $1 AND recipe_id_b = $2',
            [a, b]
        );

        if (!row) return res.status(404).json({ error: 'Alternative link not found' });

        res.status(204).send();
    }
    catch (err) {
        console.error('Database Query Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
