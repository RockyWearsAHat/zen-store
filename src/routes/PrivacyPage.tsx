export default function PrivacyPage() {
  return (
    <section className="bg-stone-900 text-stone-100 px-6 py-16 max-w-5xl mx-auto leading-relaxed">
      <h2 className="text-3xl font-bold mb-6">Privacy Notice</h2>
      <p className="mb-4">
        Zen Essentials (“we”, “our”, “us”) respects your privacy. This notice
        describes how we collect, use and share your personal information when
        you visit zen-essentials.store or purchase our products.
      </p>
      <h3 className="text-xl font-semibold mt-6 mb-2">
        1. Information We Collect
      </h3>
      <ul className="list-disc ml-6 space-y-1 mb-4">
        <li>Order &amp; contact details (name, e-mail, shipping address)</li>
        <li>
          Payment information (processed securely by Stripe – we never see full
          card numbers)
        </li>
        <li>Usage data (pages visited, device info, cookies)</li>
      </ul>
      <h3 className="text-xl font-semibold mt-6 mb-2">2. How We Use It</h3>
      <ul className="list-disc ml-6 space-y-1 mb-4">
        <li>Fulfil and ship your orders</li>
        <li>Send transactional e-mails and updates</li>
        <li>Improve our website and customer experience</li>
      </ul>
      <h3 className="text-xl font-semibold mt-6 mb-2">3. Sharing</h3>
      <p className="mb-4">
        We share data only with trusted partners necessary to operate our
        service (e.g.&nbsp;Stripe for payments, UPS for delivery). We never sell
        your data.
      </p>
      <h3 className="text-xl font-semibold mt-6 mb-2">4. Your Choices</h3>
      <p className="mb-4">
        You may review, update or delete your personal information at any time
        by contacting&nbsp;
        <a
          className="underline text-brand"
          href="mailto:alexwaldmann2004@gmail.com"
        >
          support@zen-essentials.store
        </a>
        .
      </p>
      <p className="text-sm opacity-70 mt-8">
        This notice may change; updates will be posted here. Last updated:
        {` ${new Date().toLocaleDateString("en-US")}`}.
      </p>
    </section>
  );
}
