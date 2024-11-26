require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
    { 
        auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
            timeout: 20000
        },
    }
)

// const pool = new Pool({
//     host: process.env.DB_HOST,
//     port: process.env.DB_PORT || 6543,
//     database: process.env.HOST,
//     user: process.env.DB_USER,
//     password: process.env.DB_PASSWORD,
// })

module.exports = { supabase }