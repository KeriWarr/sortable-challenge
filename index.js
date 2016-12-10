import R from 'ramda';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';


/* ----------- HELPER METHODS ----------- */


/**
 *
 */
const naiveMatching = (products, listings) =>
  products.map((product) => {
    const nonLabelChar = '[^a-z0-9]';
    const matchAnyPunctuation = label =>
      label
        .replace(new RegExp(nonLabelChar, 'i'), '')
        .split('')
        .join(`${nonLabelChar}?`);
    const productManufacturerRegex =
      new RegExp(`^${product.manufacturer}$`, 'i');
    const productModelRegex = new RegExp(
      `^(?:.*${nonLabelChar})?${matchAnyPunctuation(product.model)}(?:${nonLabelChar}.*)?$`,
      'i',
    );
    const productFamilyRegex = product.family &&
      new RegExp(
        `^(?:.*${nonLabelChar})?${matchAnyPunctuation(product.family)}(?:${nonLabelChar}.*)?$`,
        'i',
      );

    return Object.assign({}, product, {
      listings: listings.filter(listing =>
        productManufacturerRegex.test(listing.manufacturer) &&
        productModelRegex.test(listing.title) &&
        (productFamilyRegex ? productFamilyRegex.test(listing.title) : true),
      ),
    });
  });

const generateResults = (products, listings) => {
  const resultsProperties = ['product_name', 'listings'];
  const naiveMatchingProducts = naiveMatching(products, listings);

  return naiveMatchingProducts.map(R.pick(resultsProperties));
};


/* ----------- ENTRY POINT ----------- */


(() => {
  const inputFiles = {
    products: {
      fileName: 'products.txt',
      data: [],
    },
    listings: {
      fileName: 'listings.txt',
      data: [],
    },
  };
  const resultsFile = 'results.txt';
  const resultsWriteStream = createWriteStream(resultsFile);
  const totalReaderCount = R.keys(inputFiles).length;
  let closedReaderCount = 0;

  const handleReaderClosed = () => {
    closedReaderCount += 1;

    if (closedReaderCount === totalReaderCount) {
      const data = R.map(R.prop('data'), R.values(inputFiles));

      generateResults(...data).forEach(result =>
        resultsWriteStream.write(`${JSON.stringify(result)}\n`),
      );
    }
  };

  R.values(inputFiles).forEach(({ fileName, data }) => {
    createInterface({ input: createReadStream(fileName) })
      .on('line', line => data.push(JSON.parse(line)))
      .on('close', handleReaderClosed);
  });
})();
