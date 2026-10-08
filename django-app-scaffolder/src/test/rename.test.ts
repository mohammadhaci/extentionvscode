import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRenamePairs, createRenamer } from "../scaffold/rename";
import { guessSingular, splitWords, validateAppName } from "../scaffold/names";

describe("names", () => {
  it("validates app names", () => {
    assert.equal(validateAppName("invoices"), undefined);
    assert.equal(validateAppName("purchase_orders"), undefined);
    assert.match(validateAppName("Invoices")!, /snake_case/);
    assert.match(validateAppName("1x")!, /snake_case/);
    assert.match(validateAppName("class")!, /keyword/);
    assert.match(validateAppName("admin")!, /clashes/);
    assert.match(validateAppName("bad__name")!, /double/);
    assert.match(validateAppName("orders", new Set(["orders"]))!, /already exists/);
  });

  it("splits any casing into words", () => {
    assert.deepEqual(splitWords("PurchaseOrder"), ["purchase", "order"]);
    assert.deepEqual(splitWords("purchase_order"), ["purchase", "order"]);
    assert.deepEqual(splitWords("purchase-order"), ["purchase", "order"]);
    assert.deepEqual(splitWords("HTTPRequest"), ["http", "request"]);
    assert.deepEqual(splitWords("Purchase Order"), ["purchase", "order"]);
  });

  it("guesses singulars", () => {
    assert.equal(guessSingular("orders"), "order");
    assert.equal(guessSingular("categories"), "category");
    assert.equal(guessSingular("addresses"), "address");
    assert.equal(guessSingular("boxes"), "box");
    assert.equal(guessSingular("status"), "status");
    assert.equal(guessSingular("inventory"), "inventory");
    assert.equal(guessSingular("purchase_orders"), "purchase_order");
  });
});

describe("renamer", () => {
  const renamer = createRenamer(buildRenamePairs("orders", "invoices", "order", "invoice"));
  const r = (s: string): string => renamer.apply(s).text;

  it("renames every casing of app and entity", () => {
    assert.equal(r("class OrdersConfig(AppConfig):\n    name = 'apps.orders'"), "class InvoicesConfig(AppConfig):\n    name = 'apps.invoices'");
    assert.equal(r("class Order(models.Model):"), "class Invoice(models.Model):");
    assert.equal(r("OrderSerializer, OrderItem"), "InvoiceSerializer, InvoiceItem");
    assert.equal(r("order_id = get_order(orderId)"), "invoice_id = get_invoice(invoiceId)");
    assert.equal(r("ORDER_STATUS = 'orders:detail'"), "INVOICE_STATUS = 'invoices:detail'");
    assert.equal(r("templates/orders/order_list.html"), "templates/invoices/invoice_list.html");
    assert.equal(r("createOrder()"), "createInvoice()");
    assert.equal(r("verbose_name = 'Order'"), "verbose_name = 'Invoice'");
  });

  it("leaves unrelated words alone", () => {
    for (const s of ["border", "ordering", "reorder", "Ordering", "preorders", "orderly", "BORDER"]) {
      assert.equal(r(s), s);
    }
  });

  it("counts replacements", () => {
    assert.equal(renamer.apply("order orders Order border").count, 3);
  });

  it("handles multi-word names", () => {
    const m = createRenamer(buildRenamePairs("purchase_orders", "sales_quotes", "purchase_order", "sales_quote"));
    assert.equal(m.apply("PurchaseOrder purchase-orders 'Purchase order' PURCHASE_ORDERS").text, "SalesQuote sales-quotes 'Purchase order' SALES_QUOTES");
    assert.equal(m.apply("purchase order").text, "sales quote");
  });

  it("drops identical pairs", () => {
    const pairs = buildRenamePairs("inventory", "stock", "inventory", "stock");
    assert.equal(new Set(pairs.map((p) => p.from)).size, pairs.length);
    assert.ok(pairs.every((p) => p.from !== p.to));
  });
});
