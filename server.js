require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const SCHEMA = process.env.DB_SCHEMA || 'public';
const TABLE = process.env.DB_TABLE || 'podaci';

// Spajanje na bazu (pool = skup veza koje se ponovno koriste)
const pool = new Pool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 5432,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
});

// iscitavamo popis stupaca iz baze
let columns = [];
async function loadColumns() {
        const r = await pool.query(
                `SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position`,
                [SCHEMA, TABLE]
        );
        columns = r.rows.map((row) => row.column_name);
        if (columns.length === 0) {
                throw new Error(`Tablica ${SCHEMA}.${TABLE} ne postoji ili nema stupaca`);
        }
}

// SQL upit na temelju podataka o pretragi
function buildQuery(q, attr) {
        let sql = `SELECT * FROM "${SCHEMA}"."${TABLE}"`;
        const params = [];

        if (q && q.trim() !== '') {
                params.push(`%${q.trim()}%`);
                if (attr && columns.includes(attr)) {
                        sql += ` WHERE CAST("${attr}" AS TEXT) ILIKE $1`;
                } else {
                        const uvjeti = columns.map((c) => `CAST("${c}" AS TEXT) ILIKE $1`);
                        sql += ` WHERE ${uvjeti.join(' OR ')}`;
                }
        }
        sql += ` ORDER BY ID`;
        return { sql, params };
}

// Funkcija za pretvaranje redaka u CSV
function toCsv(rows) {
        const esc = (v) => {
                if (v === null || v === undefined) return '';
                const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
                return s;
        };
        const header = columns.map(esc).join(',');
        const lines = rows.map((r) => columns.map((c) => esc(r[c])).join(','));
        return [header, ...lines].join('\r\n');
}

// Funkcija za pretvaranje podataka u hjerarhijski JSON
function toJson(rows) {
        const countries = new Map();

        for (const row of rows) {
                const countryId = row.id;

                if (!countries.has(countryId)) {
                        countries.set(countryId, {
                                id: countryId,
                                country: row.country,
                                country_population: row.country_population,
                                area: row.area,
                                iso_code: row.iso_code,
                                continent: row.continent,
                                currency: row.currency,
                                currency_code: row.currency_code,
                                cities: []
                        });
                }
                if (row.city !== null) {
                        countries.get(countryId).cities.push({
                                        city: row.city,
                                        postal_code: row.postal_code
                        });
                }
        }

        return JSON.stringify([...countries.values()], null, 2); // pretvori u obično polje
}

// Popis atributa (za <select> u form-i)
app.get('/api/columns', (req, res) => res.json(columns));

// Podaci: /api/data?q=tekst&attr=stupac&format=json|csv
// format=json|csv uz download=1 vraca datoteku za preuzimanje
app.get('/api/data', async (req, res) => {
        try {
                const { q = '', attr = '', format = 'json', download } = req.query;
                const { sql, params } = buildQuery(q, attr);
                const result = await pool.query(sql, params);
                if (format === 'csv' && download) {
                        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                        res.setHeader('Content-Disposition', 'attachment; filename="data.csv"');
                        return res.send(toCsv(result.rows));
                }
                if (format === 'json' && download) {
                        res.setHeader('Content-Type', 'application/json; charset=utf-8');
                        res.setHeader('Content-Disposition', 'attachment; filename="data.json"');
                        return res.send(toJson(result.rows));
                }
                res.json(result.rows);
        } catch (err) {
                console.error(err);
                res.status(500).json({ error: 'Greska pri citanju iz baze' });
        }
});


app.use(express.static(path.join(__dirname, 'public')));

// Pokretanje
loadColumns()
        .then(() => {
                app.listen(PORT, () => {
                        console.log(`Server radi na http://localhost:${PORT}`);
                        console.log(`Tablica: ${SCHEMA}.${TABLE}, stupci: ${columns.join(', ')}`);
                });
        })
        .catch((err) => {
                console.error('Ne mogu se spojiti na bazu:', err.message);
                process.exit(1);
        });
