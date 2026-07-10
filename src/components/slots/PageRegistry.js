// Page registry — every screen that can host promotional slots.
// Keys are stable identifiers used in campaign targeting and analytics.
// New screens self-register here; admin UI reads from this list.

export const PAGE_REGISTRY = {
  business: [
    { key: "business.home",      label: "Home"       },
    { key: "business.sales",     label: "Sales"      },
    { key: "business.finance",   label: "Finance"    },
    { key: "business.reports",   label: "Reports"    },
    { key: "business.customers", label: "Customers"  },
    { key: "business.inventory", label: "Inventory"  },
    { key: "business.bills",     label: "Bills"      },
    { key: "business.insights",  label: "Insights"   },
  ],
  staff: [
    { key: "staff.home",         label: "Home"       },
    { key: "staff.sales",        label: "Sales"      },
    { key: "staff.bills",        label: "Bills"      },
  ],
  organisation: [
    { key: "org.dashboard",      label: "Dashboard"  },
    { key: "org.members",        label: "Members"    },
    { key: "org.savings",        label: "Savings"    },
  ],
  ajo_client: [
    { key: "ajo_client.home",    label: "Home"       },
  ],
  org_member: [
    { key: "org_member.home",    label: "Home"       },
  ],
};

export function getAllPages() {
  return Object.entries(PAGE_REGISTRY).flatMap(([portal, pages]) =>
    pages.map(p => ({ ...p, portal }))
  );
}

// Returns all pages that are available for a given slot+portal combination.
export function getPagesForSlot(slot, portalSlots) {
  const result = [];
  for (const [portal, pages] of Object.entries(PAGE_REGISTRY)) {
    if ((portalSlots[portal] ?? []).includes(slot)) {
      result.push(...pages.map(p => ({ ...p, portal })));
    }
  }
  return result;
}
