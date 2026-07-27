/**
 * Phase 6 Pricing — API quote tests
 * Prerequisites:
 *   1. Backend running: node server.js
 *   2. Seed data applied: schema/PHASE6_PRICING_TEST_DATA.sql
 *   3. For hourly tests: schema/PHASE6_SWITCH_EVENT_TO_PER_HOUR.sql
 *
 * Run:
 *   node scripts/phase6-pricing-test.mjs
 *   node scripts/phase6-pricing-test.mjs --mode=hourly
 */

import dotenv from 'dotenv';
import db from '../config/db.js';
import { calculateBookingTotal } from '../services/reservationPricingService.js';

dotenv.config();

const BASE = process.env.API_BASE || 'http://localhost:8000';
const mode = process.argv.includes('--mode=hourly') ? 'hourly' : 'base';
const results = [];

const record = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const approx = (actual, expected, tolerance = 0.01) => Math.abs(Number(actual) - Number(expected)) <= tolerance;

async function quoteViaApi(body) {
  const warmup = await fetch(`${BASE}/`);
  const csrfToken = warmup.headers.get('x-csrf-token')
    || warmup.headers.get('X-CSRF-Token');
  const setCookie = warmup.headers.getSetCookie?.() || [];
  const cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');

  const res = await fetch(`${BASE}/api/pricing/quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function getPromoIdByCode(code) {
  const [rows] = await db.query(
    'SELECT promo_id FROM promos WHERE code = ? LIMIT 1',
    [code]
  );
  return rows[0]?.promo_id || null;
}

async function runServiceQuote(items, options = {}) {
  return calculateBookingTotal(items, options);
}

async function main() {
  console.log(`\nPhase 6 Pricing Tests (${mode} mode) @ ${BASE}\n`);

  try {
    await fetch(`${BASE}/`);
  } catch {
    console.error('Backend not reachable. Start with: npm start');
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Security: category mismatch
  // -------------------------------------------------------------------------
  {
    const result = await runServiceQuote([{
      inventory_item_id: 12,
      category_type: 'event',
      booking_date: '2026-07-25',
      start_time: '08:00',
      end_time: '12:00',
    }]);
    record(
      'Security: item 12 as event is rejected',
      result.success === false && result.reason === 'CATEGORY_MISMATCH',
      result.reason || result.message
    );
  }

  // -------------------------------------------------------------------------
  // Base pricing (per_event mode — item 16 @ ₱3,000)
  // -------------------------------------------------------------------------
  if (mode === 'base') {
    const eventResult = await runServiceQuote([{
      inventory_item_id: 16,
      category_type: 'event',
      booking_date: '2026-08-10',
      start_time: '08:00',
      end_time: '12:00',
    }]);
    const item = eventResult.data?.items?.[0];
    record(
      'Event per_event: Functional Hall ₱3,000',
      eventResult.success && approx(item?.final_subtotal, 3000),
      `final_subtotal=${item?.final_subtotal}`
    );

    const roomResult = await runServiceQuote([{
      inventory_item_id: 2,
      category_type: 'room',
      check_in_date: '2026-07-20',
      check_out_date: '2026-07-22',
    }]);
    const roomItem = roomResult.data?.items?.[0];
    record(
      'Room: Studio Room 1 — 2 nights × ₱2,000 = ₱4,000',
      roomResult.success && approx(roomItem?.final_subtotal, 4000),
      `nights=${roomItem?.duration?.nights}, final_subtotal=${roomItem?.final_subtotal}`
    );

    const cottageResult = await runServiceQuote([{
      inventory_item_id: 8,
      category_type: 'cottage',
      booking_date: '2026-07-25',
    }]);
    const cottageItem = cottageResult.data?.items?.[0];
    record(
      'Cottage: COTTAGE day-use ₱1,500',
      cottageResult.success && approx(cottageItem?.final_subtotal, 1500),
      `final_subtotal=${cottageItem?.final_subtotal}`
    );

    const apiRes = await quoteViaApi({
      items: [{
        inventory_item_id: 16,
        category_type: 'event',
        booking_date: '2026-08-10',
        start_time: '08:00',
        end_time: '12:00',
      }],
    });
    record(
      'API /pricing/quote returns success for valid event',
      apiRes.status === 200 && apiRes.json.success === true,
      `status=${apiRes.status}`
    );
  }

  // -------------------------------------------------------------------------
  // Hourly + seasonal + promo (requires PHASE6_SWITCH_EVENT_TO_PER_HOUR.sql)
  // -------------------------------------------------------------------------
  if (mode === 'hourly') {
    const insideSeason = await runServiceQuote([{
      inventory_item_id: 16,
      category_type: 'event',
      booking_date: '2026-07-25',
      start_time: '08:00',
      end_time: '12:00',
    }]);
    const insideItem = insideSeason.data?.items?.[0];
    record(
      'Event per_hour inside July: 4h × ₱1,000 +20% = ₱4,800',
      insideSeason.success
        && approx(insideItem?.base_price, 4000)
        && approx(insideItem?.seasonal_adjustment, 800)
        && approx(insideItem?.final_subtotal, 4800),
      `base=${insideItem?.base_price}, seasonal_adj=${insideItem?.seasonal_adjustment}, final=${insideItem?.final_subtotal}`
    );

    const outsideSeason = await runServiceQuote([{
      inventory_item_id: 16,
      category_type: 'event',
      booking_date: '2026-08-05',
      start_time: '08:00',
      end_time: '12:00',
    }]);
    const outsideItem = outsideSeason.data?.items?.[0];
    record(
      'Event per_hour outside July: no seasonal adjustment',
      outsideSeason.success
        && approx(outsideItem?.seasonal_adjustment, 0)
        && approx(outsideItem?.final_subtotal, 4000),
      `seasonal_adj=${outsideItem?.seasonal_adjustment}, final=${outsideItem?.final_subtotal}`
    );

    const promoId = await getPromoIdByCode('PHASE6EVT10');
    const withPromo = await runServiceQuote([{
      inventory_item_id: 16,
      category_type: 'event',
      booking_date: '2026-07-25',
      start_time: '08:00',
      end_time: '12:00',
      promo_id: promoId,
    }]);
    const promoItem = withPromo.data?.items?.[0];
    record(
      'Promo after seasonal: ₱4,800 - 10% = ₱4,320',
      withPromo.success
        && approx(promoItem?.seasonal_adjustment, 800)
        && approx(promoItem?.promo_discount, 480)
        && approx(promoItem?.final_subtotal, 4320),
      `promo_discount=${promoItem?.promo_discount}, final=${promoItem?.final_subtotal}`
    );

    const expiredPromoId = await getPromoIdByCode('PHASE6EXPIRED');
    const expiredPromo = await runServiceQuote([{
      inventory_item_id: 16,
      category_type: 'event',
      booking_date: '2026-07-25',
      start_time: '08:00',
      end_time: '12:00',
      promo_id: expiredPromoId,
    }]);
    const expiredItem = expiredPromo.data?.items?.[0];
    record(
      'Expired promo does not apply',
      expiredPromo.success
        && approx(expiredItem?.promo_discount, 0)
        && approx(expiredItem?.final_subtotal, 4800),
      `promo_discount=${expiredItem?.promo_discount}, final=${expiredItem?.final_subtotal}`
    );
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
