{
  description = "rsfinity: swap the base of Gridfinity bins in the browser";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          # openscad-unstable is only needed to generate real test models (see README).
          packages = [ pkgs.nodejs_24 pkgs.openscad-unstable ];
        };
      });
    };
}
