import {
  getDashboardKpis,
  getOccupancyOverview,
  getPeriodRange,
  getRecentBookings,
  getRevenueSummary,
  getSalesByChannel,
  getTodayCheckIns,
  getTodayCheckOuts,
} from "../services/adminDashboardService.js";

export const getOperationsDashboard = async (req, res) => {
  try {
    const period = req.query.period || "day";
    const { startDate, endDate } = getPeriodRange(period);

    const [
      kpis,
      occupancy,
      todayCheckIns,
      todayCheckOuts,
      recentBookings,
      salesByChannel,
      revenue,
    ] = await Promise.all([
      getDashboardKpis(startDate, endDate),
      getOccupancyOverview(startDate, endDate),
      getTodayCheckIns(startDate, endDate),
      getTodayCheckOuts(startDate, endDate),
      getRecentBookings(startDate, endDate),
      getSalesByChannel(startDate, endDate),
      getRevenueSummary(startDate, endDate),
    ]);

    return res.json({
      success: true,
      data: {
        kpis,
        occupancy,
        today: {
          checkIns: todayCheckIns,
          checkOuts: todayCheckOuts,
        },
        recentBookings,
        salesByChannel,
        revenue,
      },
    });
  } catch (error) {
    console.error("Dashboard operations error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load dashboard operations data",
    });
  }
};
