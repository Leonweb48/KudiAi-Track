import { useState } from "react";

function generateInsights(summary) {
  const { totalIn = 0, totalOut = 0, profit = 0, txCount = 0,
          topItems = [], period = "today" } = summary;

  const insights = [];
  const warnings = [];
  const opportunities = [];
  const actions = [];

  // Profit margin analysis
  if (totalIn > 0) {
    const margin = ((profit / totalIn) * 100).toFixed(1);
    if (profit > 0) {
      insights.push(`Your profit margin is ${margin}% for ${period}. ${margin > 30 ? "Excellent performance!" : "There's room to grow."}`);
    } else {
      warnings.push(`You're currently running at a loss for ${period}. Expenses (₦${totalOut.toLocaleString()}) exceed income (₦${totalIn.toLocaleString()}).`);
    }
  }

  // Transaction volume
  if (txCount === 0) {
    insights.push("No transactions recorded yet. Start logging sales and expenses to see insights.");
  } else if (txCount < 3) {
    insights.push(`Only ${txCount} transaction${txCount > 1 ? "s" : ""} recorded. Log more to get accurate insights.`);
  } else {
    insights.push(`You've recorded ${txCount} transactions for ${period}.`);
  }

  // Top items
  if (topItems.length > 0) {
    insights.push(`Your best-selling item is "${topItems[0]}" — consider stocking more of it.`);
  }

  // Spending warnings
  if (totalOut > totalIn * 0.7 && totalIn > 0) {
    warnings.push("Your expenses are very high relative to income. Review your spending categories.");
  }

  // Opportunities
  if (profit > 0 && profit < 10000) {
    opportunities.push("Try upselling to existing customers — even a 10% increase per sale can significantly boost profit.");
  }
  if (totalIn > 50000) {
    opportunities.push("Your sales volume is strong. Consider bulk purchase discounts from suppliers to reduce costs.");
  }
  if (txCount > 5) {
    opportunities.push("You have regular customers. A simple loyalty note (e.g. 'buy 5 get 1 free') could increase repeat sales.");
  }

  // Actions
  actions.push("Record every sale and expense — even small ones add up.");
  if (totalOut > 0) actions.push("Review your top expense categories and see where you can cut costs.");
  if (topItems.length > 1) actions.push(`Focus marketing efforts on "${topItems[0]}" and "${topItems[1]}" — your top sellers.`);
  actions.push("Check your credit list and follow up on any overdue payments today.");

  return {
    insights:      insights.slice(0, 3),
    warnings:      warnings.slice(0, 2),
    opportunities: opportunities.slice(0, 3),
    actions:       actions.slice(0, 4),
  };
}

export function useAI() {
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState(null);

  const analyze = async (summary) => {
    setLoading(true);
    setError(null);
    setResult(null);

    // Small delay for UX
    await new Promise((r) => setTimeout(r, 600));

    try {
      const data = generateInsights(summary);
      setResult(data);
    } catch (e) {
      setError("Could not generate insights. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return { loading, result, error, analyze };
}
