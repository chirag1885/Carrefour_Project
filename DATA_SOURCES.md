# Data sources

| Source | Licence | Original currency | Seed exchange rate |
| --- | --- | --- | --- |
| [Daqing Chen, Online Retail (2015), UCI Machine Learning Repository](https://doi.org/10.24432/C5BW33) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | GBP | 1 GBP = 4.70 AED |
| Generated fixtures in `scripts/seed_products.py` and `scripts/seed.py` | Authored for this repository | AED | 1 AED = 1 AED |

UCI publishes the [dataset description and licence](https://archive.ics.uci.edu/dataset/352/online+retail)
and the [download ZIP](https://archive.ics.uci.edu/static/public/352/online+retail.zip).
`make download-datasets` caches the ZIP in `data/raw/`, which Git ignores.
The verified archive SHA-256 is
`f5385cbb54bbebf7196389109c6b0621faab0c304e3702548165e71c84aede8b`.

The importer deduplicates by StockCode against the first positive sale row with a usable description,
normalises names, assigns a canonical category and rounds the converted amount to AED cents.
The rate is a fixed demo assumption. Imported list prices are generated at 120% of the converted
unit price. The importer uses product fields only and creates the seeded accounts independently
with Faker.

The small profile uses up to 1,200 imported products. The full profile uses all qualifying
products up to 5,000. Generated products fill the remaining slots and guarantee the required
category coverage and 40 demo-priced laptops. Product rows identify their origin with
`source` and `external_id`. Image URLs point to generic placeholders.
Store locations are approximate demo coordinates. Inventory, user activity and prices for
generated products are fixture data.
