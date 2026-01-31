import express from "express";
import { getPromos, createPromo, updatePromo, deletePromo } from "../controllers/promosController.js";

const router = express.Router();

router.get("/", getPromos);
router.post("/", createPromo);
router.put("/:id", updatePromo);
router.delete("/:id", deletePromo);

export default router;
