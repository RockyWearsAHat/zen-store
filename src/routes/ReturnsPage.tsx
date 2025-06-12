export default function ReturnsPage() {
  return (
    <section className="bg-stone-900 text-stone-100 px-6 py-16 max-w-5xl mx-auto leading-relaxed">
      <h2 className="text-3xl font-bold mb-6">Returns &amp; Refunds Policy</h2>
      <p className="mb-4">
        We want you to love your Zen Essentials purchase. If you are not 100%
        satisfied you may return most new, unused items within&nbsp;30&nbsp;days
        of delivery for a full refund.
      </p>
      <h3 className="text-xl font-semibold mt-6 mb-2">Eligibility</h3>
      <ul className="list-disc ml-6 space-y-1 mb-4">
        <li>Item must be in its original condition and packaging.</li>
        <li>Proof of purchase (order ID) is required.</li>
        <li>Gift cards and downloadable products are non-returnable.</li>
      </ul>
      <h3 className="text-xl font-semibold mt-6 mb-2">How to Start a Return</h3>
      <ol className="list-decimal ml-6 space-y-1 mb-4">
        <li>
          E-mail&nbsp;
          <a
            className="underline text-brand"
            href="mailto:returns@zen-essentials.store"
          >
            returns@zen-essentials.store
          </a>{" "}
          with your order ID&nbsp;and reason.
        </li>
        <li>We will provide an RMA&nbsp;number and return shipping label.</li>
        <li>
          Ship the item back within&nbsp;14&nbsp;days of receiving the label.
        </li>
      </ol>
      <h3 className="text-xl font-semibold mt-6 mb-2">Refunds</h3>
      <p>
        Once we receive and inspect your return, your refund will be processed
        to the original payment method within&nbsp;5 business days. Shipping
        costs are refundable if the return is due to our error or a defective
        product.
      </p>
    </section>
  );
}
