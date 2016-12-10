import R from 'ramda';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';


/* ----------- DATA PROCESSING ----------- */


/**
 *
 */
const firstPass = (products, listings) =>
  products.map(product => Object.assign({}, product, {
    listings: listings.reduce((productListings, listing) => {
      const productManufacturerRegex =
        new RegExp(`^${product.manufacturer}$`, 'i');
      const productModelRegex = new RegExp(product.model, 'i');
      const productFamilyRegex = new RegExp(product.family || '', 'i');

      if (productManufacturerRegex.test(listing.manufacturer)
        && productModelRegex.test(listing.title)
        && productFamilyRegex.test(listing.title)) {
        return productListings.concat([listing]);
      }
      return productListings;
    }, product.listings),
  }));


/**
 *
 */
const generateResults = (products, listings) => {
  const resultsProperties = ['product_name', 'listings'];
  const productsWithListings = products.map(
    product => Object.assign({},
      product,
      { listings: [] },
    ),
  );

  const firstPassProducts = firstPass(productsWithListings, listings);

  return firstPassProducts.map(R.pick(resultsProperties));
};


/* ----------- FILE PROCESSING ----------- */


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
      const { products, listings } = inputFiles;

      generateResults(products.data, listings.data).forEach(result =>
        resultsWriteStream.write(`${JSON.stringify(result)}\n`),
      );
    }
  };

  R.values(inputFiles).map(({ fileName, data }) =>
    createInterface({ input: createReadStream(fileName) })
      .on('line', line => data.push(JSON.parse(line)))
      .on('close', handleReaderClosed),
  );
})();
