# Working rules for cmdk

## Check the protocol repository before changing any logic

The protocol repository is https://github.com/cmdkfi/app. Call it the protocol repository, not the backend.

Before implementing or changing logic, check the corresponding code in cmdkfi/app: the contracts, ABIs, API, network and deployment configuration, and the order of transactions. On any ambiguity, go to the protocol repository first and decide on the basis of verified code. Never substitute assumptions or mocks for missing data. If the code gives no clear answer, ask the protocol developer.
