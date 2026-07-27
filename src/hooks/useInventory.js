import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";
import { uid } from "../utils/helpers";
import { sendEmailTrigger } from "../utils/emailTrigger";
import { notify, notifyBranchManager, notifyBranchStaff } from "../lib/notifyEngine";

function invCacheKey(userId, staffId) {
  return `kt_inv_${userId}${staffId ? `_${staffId}` : ""}`;
}
function saveInvCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}
function loadInvCache(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

export function useInventory(userId, staffId = null, branchId = null, staffName = null) {
  const [products,  setProducts]  = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [dbError,   setDbError]   = useState(null);

  const loadData = useCallback(async () => {
    if (!userId || !supabase) { setLoading(false); return; }

    // ── Offline: serve from local cache ──────────────────────────────
    if (!navigator.onLine) {
      const cached = loadInvCache(invCacheKey(userId, staffId));
      if (cached) {
        if (cached.products)  setProducts(cached.products);
        if (cached.movements) setMovements(cached.movements);
      }
      setLoading(false);
      return;
    }

    // Staff reads go through get_products_safe() (SECURITY DEFINER) which returns
    // cost_price = NULL. Dropping staff_read_products blocks direct table access.
    // Owner reads use the table directly and receive all columns including cost_price.
    const pQ = staffId
      ? supabase.rpc("get_products_safe", { p_owner_id: userId, p_branch_id: branchId || null })
      : supabase.from("products").select("*").eq("user_id", userId).order("product_name");
    let mQ = supabase.from("stock_movements").select("*").eq("user_id", userId);
    if (branchId) mQ = mQ.eq("branch_id", branchId);
    const [pRes, mRes] = await Promise.all([
      pQ,
      mQ.order("created_at", { ascending: false }).limit(500),
    ]);
    if (pRes.data) {
      let prods = pRes.data;
      // Staff with no branch: the RPC returns all products (p_branch_id=null = no filter).
      // Apply client-side filter so staff only see products explicitly on their branch
      // or auto-stubs/products they personally created (staff_id matches).
      if (staffId && !branchId) {
        prods = prods.filter(p => p.staff_id === staffId);
      }
      setProducts(prods);
      saveInvCache(invCacheKey(userId, staffId), {
        products: prods,
        movements: mRes.data || [],
      });
    }
    if (mRes.data)  setMovements(mRes.data);
    setLoading(false);
  }, [userId, staffId, branchId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime sync — all staff accounts see live qty changes
  useEffect(() => {
    if (!userId || !supabase) return;
    const ch = supabase.channel(`inv_${userId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "products",
        filter: `user_id=eq.${userId}`,
      }, loadData)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "stock_movements",
        filter: `user_id=eq.${userId}`,
      }, loadData)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [userId, loadData]);

  const addProduct = useCallback(async (data) => {
    if (!supabase) return false;
    // Explicit non-empty branch_id from form takes precedence; otherwise fall back to hook-level branchId
    const effectiveBranch = (data.branch_id != null && data.branch_id !== "")
      ? data.branch_id
      : (branchId || null);
    const prod = {
      id:                  uid(),
      user_id:             userId,
      branch_id:           effectiveBranch,
      product_name:        String(data.product_name || "").trim(),
      sku:                 String(data.sku || "").trim(),
      category:            String(data.category || "").trim(),
      cost_price:          parseFloat(data.cost_price)          || 0,
      selling_price:       parseFloat(data.selling_price)       || 0,
      quantity:            parseInt(data.quantity)              || 0,
      low_stock_threshold: parseInt(data.low_stock_threshold)   || 5,
    };
    const { error } = await supabase.from("products").insert(prod);
    if (error) { setDbError(error.message); return false; }
    if (prod.quantity > 0) {
      sendEmailTrigger("stock_entry", {
        owner_id: userId,
        staff_id: staffId || null,
        branch_id: effectiveBranch,
        product_name: prod.product_name,
        quantity: prod.quantity,
        category: prod.category || null,
        entry_type: "new_product",
      });
      // Auto-record opening stock cost as a financial transaction so it flows
      // into cash flow and working capital without manual entry.
      if (prod.cost_price > 0) {
        const stockCost = prod.cost_price * prod.quantity;
        await supabase.from("transactions").insert({
          id:               uid(),
          user_id:          userId,
          staff_id:         staffId || null,
          branch_id:        effectiveBranch,
          type:             "out",
          category:         "stock",
          amount:           stockCost,
          item_name:        prod.product_name,
          quantity:         prod.quantity,
          customer_name:    "",
          payment_type:     "cash",
          note:             "Opening stock (auto)",
          transaction_date: new Date().toISOString().slice(0, 10),
          bill_status:      null,
          client_txn_id:    uid(),
        });
      }
    }
    setProducts(prev => [...prev, prod].sort((a, b) => a.product_name.localeCompare(b.product_name)));
    return true;
  }, [userId, staffId, branchId]);

  const updateProduct = useCallback(async (id, data) => {
    if (!supabase) return false;
    const upd = {
      product_name:        String(data.product_name || "").trim(),
      sku:                 String(data.sku || "").trim(),
      category:            String(data.category || "").trim(),
      cost_price:          parseFloat(data.cost_price)          || 0,
      selling_price:       parseFloat(data.selling_price)       || 0,
      quantity:            parseInt(data.quantity)              || 0,
      low_stock_threshold: parseInt(data.low_stock_threshold)   || 5,
      updated_at:          new Date().toISOString(),
    };
    const { error } = await supabase.from("products").update(upd).eq("id", id);
    if (error) { setDbError(error.message); return false; }
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...upd } : p));
    return true;
  }, []);

  const assignProduct = useCallback(async (id, newBranchId) => {
    if (!supabase) return false;
    const upd = { branch_id: newBranchId, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("products").update(upd).eq("id", id);
    if (error) { setDbError(error.message); return false; }
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...upd } : p));
    return true;
  }, []);

  const deleteProduct = useCallback(async (id) => {
    if (!supabase) return false;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) { setDbError(error.message); return false; }
    setProducts(prev => prev.filter(p => p.id !== id));
    return true;
  }, []);

  // Auto-stub: called fire-and-forget from AddTxnModal when a sale has an item_name
  // that doesn't match any existing product. Creates a placeholder with no cost_price
  // or quantity, flagged needs_costing=true for the owner to complete later.
  const createAutoStub = useCallback(async (name, sellingPrice, saleQty) => {
    if (!supabase || !userId || !name?.trim()) return;
    const normName = name.trim();
    const normLow  = normName.toLowerCase();
    if (products.some(p => p.product_name.toLowerCase().trim() === normLow)) return;

    const prodId = uid();
    const prod = {
      id:                  prodId,
      user_id:             userId,
      branch_id:           branchId || null,
      product_name:        normName,
      sku:                 "",
      category:            "",
      cost_price:          null,
      selling_price:       parseFloat(sellingPrice) || 0,
      quantity:            null,
      low_stock_threshold: 5,
      source:              "auto_sale",
      needs_costing:       true,
    };
    const mov = {
      id:         uid(),
      user_id:    userId,
      branch_id:  branchId || null,
      product_id: prodId,
      type:       "sale",
      quantity:   -Math.abs(parseInt(saleQty) || 1),
      unit_price: parseFloat(sellingPrice) || 0,
      notes:      "Auto-created from sale",
      staff_id:   staffId || null,
      created_at: new Date().toISOString(),
    };

    Promise.all([
      supabase.from("products").insert(prod),
      supabase.from("stock_movements").insert(mov),
    ]).then(([pr, mr]) => {
      if (pr.error || mr.error) console.warn("[auto-stub] insert failed:", (pr.error || mr.error).message);
    }).catch(e => console.warn("[auto-stub] error:", e?.message || e));

    setProducts(prev => [...prev, prod].sort((a, b) => a.product_name.localeCompare(b.product_name)));
    setMovements(prev => [mov, ...prev]);
  }, [userId, staffId, branchId, products]);

  // Owner completes a stub: sets cost_price + opening quantity, clears needs_costing flag.
  // Past sales' margin is NOT retroactively computed — only future sales benefit from
  // the cost price. The UI makes this explicit.
  const completeCosting = useCallback(async (id, costPrice, openingQty) => {
    if (!supabase) return false;
    const upd = {
      cost_price:    parseFloat(costPrice) || 0,
      quantity:      parseInt(openingQty)  || 0,
      needs_costing: false,
      updated_at:    new Date().toISOString(),
    };
    const { error } = await supabase.from("products").update(upd).eq("id", id);
    if (error) { setDbError(error.message); return false; }
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...upd } : p));
    return true;
  }, []);

  const recordMovement = useCallback(async ({ product_id, type, quantity, unit_price, notes }) => {
    if (!supabase) return false;
    const product = products.find(p => p.id === product_id);
    if (!product) return false;

    const inputQty = parseInt(quantity) || 0;
    if (!inputQty) return false;

    const delta = type === "sale"     ? -Math.abs(inputQty)
                : type === "restock"  ?  Math.abs(inputQty)
                : inputQty; // adjustment: signed

    const newQty = Math.max(0, product.quantity + delta);

    const unitPrice = parseFloat(unit_price) || 0;
    const absQty    = Math.abs(inputQty);

    const mov = {
      id:         uid(),
      user_id:    userId,
      branch_id:  branchId || null,
      product_id,
      type,
      quantity:   delta,
      unit_price: unitPrice,
      notes:      String(notes || "").trim(),
      staff_id:   staffId || null,
      created_at: new Date().toISOString(),
    };

    // On restock, auto-update cost_price so profitEngine always has accurate COGS.
    const costUpdates = (type === "restock" && unitPrice > 0)
      ? { quantity: newQty, cost_price: unitPrice, needs_costing: false, updated_at: new Date().toISOString() }
      : { quantity: newQty, updated_at: new Date().toISOString() };

    const [{ error: me }, { error: pe }] = await Promise.all([
      supabase.from("stock_movements").insert(mov),
      supabase.from("products").update(costUpdates).eq("id", product_id),
    ]);

    if (me || pe) { setDbError((me || pe).message); return false; }

    // Auto-record stock purchase cost as a financial transaction so it flows
    // into cash flow and working capital without the owner needing to enter it manually.
    if (type === "restock" && unitPrice > 0) {
      await supabase.from("transactions").insert({
        id:               uid(),
        user_id:          userId,
        staff_id:         staffId || null,
        branch_id:        branchId || null,
        type:             "out",
        category:         "stock",
        amount:           unitPrice * absQty,
        item_name:        product.product_name,
        quantity:         absQty,
        customer_name:    "",
        payment_type:     "cash",
        note:             "Stock restock (auto)",
        transaction_date: new Date().toISOString().slice(0, 10),
        bill_status:      null,
        client_txn_id:    uid(),
      });

      sendEmailTrigger("stock_entry", {
        owner_id:     userId,
        staff_id:     staffId || null,
        branch_id:    branchId || null,
        product_name: product.product_name,
        quantity:     absQty,
        category:     product.category || null,
        entry_type:   "restock",
      });
    }

    if (type === "restock") {
      // Use the hook's branchId (staff/manager) or fall back to the product's own branch_id
      // so that owner-portal restocks also reach the right branch.
      const effectiveBranchId = branchId || product.branch_id || null;

      if (effectiveBranchId) {
        const restockData = {
          ownerId:     userId,
          staffName:   staffName || null,
          productName: product.product_name,
          productId:   product_id,
          quantity:    absQty,
          branchId:    effectiveBranchId,
        };
        const restockOpts = {
          type:         "branch_restock",
          originUserId: staffId || userId,
          data:          restockData,
        };

        // Notify owner when a staff member or manager adds stock
        if (staffId) {
          notify({ type: "branch_restock", userId, originUserId: staffId, data: restockData });
        }

        // Notify branch manager (skipped automatically if manager is the actor)
        notifyBranchManager(userId, effectiveBranchId, restockOpts);

        // Notify all other branch staff (skips the actor)
        notifyBranchStaff(userId, effectiveBranchId, restockOpts);
      }
    }

    setMovements(prev => [mov, ...prev]);
    setProducts(prev => prev.map(p =>
      p.id === product_id
        ? { ...p, quantity: newQty, ...(type === "restock" && unitPrice > 0 ? { cost_price: unitPrice, needs_costing: false } : {}) }
        : p
    ));

    if (newQty <= product.low_stock_threshold) {
      // Fire email + push once when crossing below threshold (not on every subsequent sale)
      if (product.quantity > product.low_stock_threshold) {
        sendEmailTrigger("low_stock_alert", {
          owner_id:      userId,
          staff_id:      staffId || null,
          product_name:  product.product_name,
          current_stock: newQty,
          reorder_level: product.low_stock_threshold,
          category:      product.category || null,
          sku:           product.sku || "",
        });
        notify({
          type:         "low_stock",
          userId,
          originUserId: staffId || userId,
          data: {
            productName: product.product_name,
            productId:   product.id,
            quantity:    newQty,
          },
        });
      }
    }
    return true;
  }, [userId, staffId, branchId, staffName, products]);

  // Analytics — computed inline on every access
  const salesQty = {}, salesRev = {};
  movements.forEach(m => {
    if (m.type === "sale") {
      const q = Math.abs(m.quantity);
      salesQty[m.product_id] = (salesQty[m.product_id] || 0) + q;
      salesRev[m.product_id] = (salesRev[m.product_id] || 0) + q * (m.unit_price || 0);
    }
  });

  const ago30 = new Date(); ago30.setDate(ago30.getDate() - 30);
  const recentIds = new Set(
    movements.filter(m => m.type === "sale" && new Date(m.created_at) > ago30).map(m => m.product_id)
  );

  const analytics = {
    bestSelling: [...products]
      .map(p => ({ ...p, unitsSold: salesQty[p.id] || 0, revenue: salesRev[p.id] || 0 }))
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .filter(p => p.unitsSold > 0)
      .slice(0, 10),

    slowMoving: products
      .filter(p => !recentIds.has(p.id) && p.quantity > 0)
      .map(p => ({ ...p, unitsSold: salesQty[p.id] || 0, daysSinceActivity: 30 }))
      .slice(0, 10),

    mostProfitable: [...products]
      .map(p => ({
        ...p,
        margin: p.cost_price > 0 ? ((p.selling_price - p.cost_price) / p.cost_price) * 100 : 0,
        profit: p.selling_price - p.cost_price,
      }))
      .filter(p => p.profit > 0)
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 10),

    lowStock:    products.filter(p => p.quantity <= p.low_stock_threshold),
    totalCost:   products.reduce((s, p) => s + p.cost_price * p.quantity, 0),
    totalRetail: products.reduce((s, p) => s + p.selling_price * p.quantity, 0),
  };

  // Stub stats — products awaiting costing, enriched with sale count + revenue from movements
  const stubStats = products
    .filter(p => p.needs_costing)
    .map(p => {
      const saleMoves = movements.filter(m => m.product_id === p.id && m.type === "sale");
      return {
        ...p,
        timesSold:    saleMoves.length,
        totalRevenue: saleMoves.reduce((s, m) => s + (m.unit_price || 0) * Math.abs(m.quantity || 0), 0),
      };
    });

  return {
    products, movements, loading, dbError, analytics, stubStats,
    addProduct, updateProduct, assignProduct, deleteProduct, recordMovement,
    createAutoStub, completeCosting,
    clearDbError: () => setDbError(null), reload: loadData,
  };
}
