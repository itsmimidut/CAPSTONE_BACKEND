export const FULFILLMENT_METHOD = Object.freeze({
    DELIVERY: 'delivery',
    PICKUP: 'pickup',
});

export const FULFILLMENT_STATUS = Object.freeze({
    RECEIVED: 'received',
    PREPARING: 'preparing',
    OUT_FOR_DELIVERY: 'out_for_delivery',
    DELIVERED: 'delivered',
    READY_FOR_PICKUP: 'ready_for_pickup',
    PICKED_UP: 'picked_up',
    CANCELLED: 'cancelled',
});

export const DELIVERY_TRANSITIONS = Object.freeze({
    received: ['preparing', 'cancelled'],
    preparing: ['out_for_delivery', 'cancelled'],
    out_for_delivery: ['delivered', 'cancelled'],
    delivered: [],
    cancelled: [],
});

export const PICKUP_TRANSITIONS = Object.freeze({
    received: ['preparing', 'cancelled'],
    preparing: ['ready_for_pickup', 'cancelled'],
    ready_for_pickup: ['picked_up', 'cancelled'],
    picked_up: [],
    cancelled: [],
});

export const COMPLETED_STATUSES = Object.freeze([
    FULFILLMENT_STATUS.DELIVERED,
    FULFILLMENT_STATUS.PICKED_UP,
]);

export const TERMINAL_STATUSES = Object.freeze([
    ...COMPLETED_STATUSES,
    FULFILLMENT_STATUS.CANCELLED,
]);

export const TAB_STATUS_MAP = Object.freeze({
    received: [FULFILLMENT_STATUS.RECEIVED],
    preparing: [FULFILLMENT_STATUS.PREPARING],
    dispatch_pickup: [
        FULFILLMENT_STATUS.OUT_FOR_DELIVERY,
        FULFILLMENT_STATUS.READY_FOR_PICKUP,
    ],
    completed: COMPLETED_STATUSES,
    cancelled: [FULFILLMENT_STATUS.CANCELLED],
});

export const FULFILLMENT_LABELS = Object.freeze({
    received: 'Received',
    preparing: 'Preparing',
    out_for_delivery: 'On the Way',
    delivered: 'Delivered',
    ready_for_pickup: 'Ready for Pickup',
    picked_up: 'Picked Up',
    cancelled: 'Cancelled',
});
