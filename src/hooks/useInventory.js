import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../utils/supabase";
import { uid } from "../utils/helpers";

export function useInventory(userId, staffId = null, onNotify = null, branchId = null) {
  const [products,  setProducts]  = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [dbError,   setDbError]   = useState(null);

  const notifyRef = useRef(onNotify);
  useEffect(() => { notifyRef.current = onNotify; }, [onNotify]);

  const loadData = useCallback(async () => {
    if (!userId || !supabase) { setLoading(false); return; }
    let pQ = supabase.from("products").select("*").eq("user_id", userId).order("product_name");
    // Branch staff see their branch stock + main business stock (no branch), so they can sell from either
    if (branchId) pQ = pQ.or(`branch_id.eq.${branchId},branch_id.is.null`);
    const [pRes, mRes] = await Promise.all([
      pQ,
      supabase.from("stock_movements").select("*").eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(500),
    ]);
    if (pRes.data)  setProducts(pRes.data);
    if (mRes.data)  setMovements(mRes.data);
    setLoading(false);
  }, [userId, branchId]);

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
      fetch("https://admin.kudiai.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": process.env.REACT_APP_EMAIL_SECRET },
        body: JSON.stringify({
          event: "stock_entry",
          data: {
            owner_id: userId,
            staff_id: staffId || null,
            branch_id: effectiveBranch,
            product_name: prod.product_name,
            quantity: prod.quantity,
            category: prod.category || null,
            entry_type: "new_product",
          },
        }),
      }).catch(() => null);
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

  const deleteProduct = useCallback(async (id) => {
    if (!supabase) return false;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) { setDbError(error.message); return false; }
    setProducts(prev => prev.filter(p => p.id !== id));
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

    const mov = {
      id:         uid(),
      user_id:    userId,
      branch_id:  branchId || null,
      product_id,
      type,
      quantity:   delta,
      unit_price: parseFloat(unit_price) || 0,
      notes:      String(notes || "").trim(),
      staff_id:   staffId || null,
      created_at: new Date().toISOString(),
    };

    const [{ error: me }, { error: pe }] = await Promise.all([
      supabase.from("stock_movements").insert(mov),
      supabase.from("products").update({ quantity: newQty, updated_at: new Date().toISOString() }).eq("id", product_id),
    ]);

    if (me || pe) { setDbError((me || pe).message); return false; }

    if (type === "restock") {
      fetch("https://admin.kudiai.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": process.env.REACT_APP_EMAIL_SECRET },
        body: JSON.stringify({
          event: "stock_entry",
          data: {
            owner_id: userId,
            staff_id: staffId || null,
            branch_id: branchId || null,
            product_name: product.product_name,
            quantity: Math.abs(inputQty),
            category: product.category || null,
            entry_type: "restock",
          },
        }),
      }).catch(() => null);
    }

    setMovements(prev => [mov, ...prev]);
    setProducts(prev => prev.map(p => p.id === product_id ? { ...p, quantity: newQty } : p));

    if (newQty <= product.low_stock_threshold) {
      notifyRef.current?.("stock", `Low Stock: ${product.product_name}`, `Only ${newQty} unit${newQty !== 1 ? "s" : ""} remaining`);
    }
    return true;
  }, [userId, staffId, branchId, products]);

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

  return {
    products, movements, loading, dbError, analytics,
    addProduct, updateProduct, deleteProduct, recordMovement,
    clearDbError: () => setDbError(null), reload: loadData,
  };
}
