import express from "express";
import { getRooms, getRoom, createRoom, updateRoom, deleteRoom, upload, getGroupedRooms } from "../controllers/roomsController.js";

const router = express.Router();

// Wraps multer so that:
// 1. Multer parse errors return a 400 instead of crashing
// 2. req.body is always at least {} (Express 5 leaves it undefined for multipart)
const handleUpload = (req, res, next) => {
    upload.array('images', 20)(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        req.body = req.body || {};
        next();
    });
};

router.get("/", getRooms);
router.get("/grouped", getGroupedRooms);
router.get("/:id", getRoom);
router.post("/", handleUpload, createRoom);
router.put("/:id", handleUpload, updateRoom);
router.delete("/:id", deleteRoom);

export default router;
