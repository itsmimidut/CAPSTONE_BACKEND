import express from "express";
import {
  getPromos,
  createPromo,
  updatePromo,
  deletePromo,
  validatePromo
} from "../controllers/promosController.js";

const router = express.Router();

router.post("/validate", validatePromo);
router.get("/", getPromos);
router.post("/", createPromo);
router.put("/:id", updatePromo);
router.delete("/:id", deletePromo);

export default router;