import { getCustomerTopPicks } from "../services/customerDashboardService.js";

export const getTopPicks = async (_req, res) => {
  try {
    const data = await getCustomerTopPicks();

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error fetching customer top picks:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch top picks",
    });
  }
};
