const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Create data directory if it doesn't exist
if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
}

// Data file path
const DATA_FILE = path.join(__dirname, 'data', 'scammers.json');

// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
        files: 6 // Maximum 6 files
    },
    fileFilter: function (req, file, cb) {
        // Check if file is an image
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Helper functions
function readScammers() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading scammers data:', error);
        return [];
    }
}

function writeScammers(scammers) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(scammers, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing scammers data:', error);
        return false;
    }
}

// Routes

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all scammers
app.get('/api/scammers', (req, res) => {
    try {
        const scammers = readScammers();
        // Sort by creation date (newest first)
        scammers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(scammers);
    } catch (error) {
        console.error('Error fetching scammers:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add new scammer
app.post('/api/scammer', upload.array('evidence', 6), (req, res) => {
    try {
        const { name, scamType, phone, website, description } = req.body;

        // Validation
        if (!name || !scamType) {
            return res.status(400).json({ error: 'Nama dan jenis penipuan wajib diisi' });
        }

        // Prepare evidence files
        const evidenceFiles = req.files ? req.files.map(file => file.filename) : [];

        // Create new scammer object
        const newScammer = {
            id: Date.now().toString(),
            name: name.trim(),
            scamType: scamType.trim(),
            phone: phone ? phone.trim() : '',
            website: website ? website.trim() : '',
            description: description ? description.trim() : '',
            evidence: evidenceFiles,
            createdAt: new Date().toISOString()
        };

        // Read existing data
        const scammers = readScammers();

        // Add new scammer
        scammers.push(newScammer);

        // Save to file
        if (writeScammers(scammers)) {
            res.status(201).json({
                success: true,
                message: 'Scammer berhasil ditambahkan',
                data: newScammer
            });
        } else {
            res.status(500).json({ error: 'Gagal menyimpan data' });
        }

    } catch (error) {
        console.error('Error adding scammer:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete scammer (optional feature)
app.delete('/api/scammer/:id', (req, res) => {
    try {
        const { id } = req.params;
        const scammers = readScammers();
        
        const scammerIndex = scammers.findIndex(s => s.id === id);
        
        if (scammerIndex === -1) {
            return res.status(404).json({ error: 'Scammer tidak ditemukan' });
        }

        // Delete associated files
        const scammer = scammers[scammerIndex];
        if (scammer.evidence && scammer.evidence.length > 0) {
            scammer.evidence.forEach(filename => {
                const filePath = path.join(__dirname, 'uploads', filename);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            });
        }

        // Remove from array
        scammers.splice(scammerIndex, 1);

        // Save updated data
        if (writeScammers(scammers)) {
            res.json({ success: true, message: 'Scammer berhasil dihapus' });
        } else {
            res.status(500).json({ error: 'Gagal menghapus data' });
        }

    } catch (error) {
        console.error('Error deleting scammer:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Search scammers
app.get('/api/search', (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q) {
            return res.json([]);
        }

        const scammers = readScammers();
        const searchTerm = q.toLowerCase();

        const filtered = scammers.filter(scammer => 
            scammer.name.toLowerCase().includes(searchTerm) ||
            scammer.scamType.toLowerCase().includes(searchTerm) ||
            (scammer.phone && scammer.phone.includes(searchTerm)) ||
            (scammer.description && scammer.description.toLowerCase().includes(searchTerm))
        );

        // Sort by creation date (newest first)
        filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json(filtered);
    } catch (error) {
        console.error('Error searching scammers:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File terlalu besar. Maksimal 5MB per file.' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Terlalu banyak file. Maksimal 6 file.' });
        }
    }
    
    if (error.message === 'Only image files are allowed!') {
        return res.status(400).json({ error: 'Hanya file gambar yang diizinkan!' });
    }

    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
    console.log(`Data scammer disimpan di: ${DATA_FILE}`);
    console.log(`Upload folder: ${path.join(__dirname, 'uploads')}`);
});

module.exports = app;
